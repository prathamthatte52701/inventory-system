// Cross-cutting session / route-guard checks that aren't specific to a single admin page.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, as, loginApi, makeUser, session, renderApp } from './helpers';

describe('Security: direct URL access as a signed-in non-admin', () => {
  it('never renders protected content for a non-admin session hitting a protected route directly, for any of several routes', async () => {
    const u = await makeUser(); // a real, approved, non-admin user
    await session(u); // logs in through the admin app's own axios so the cookie lands in the jsdom jar, same as a returning browser tab

    for (const [route, heading] of [['/materials', 'Manage Materials'], ['/users', 'Users'], ['/audit', 'Audit Log']]) {
      const { unmount } = renderApp(route);
      // immediately after render, before any findBy/waitFor tick: the protected heading must never be in the DOM,
      // not even for one frame while the session is still being verified (that window should show nothing / a loader instead)
      expect(screen.queryByRole('heading', { name: heading })).toBeNull();

      // the session check resolves (this user is real but not an admin) and the app lands on /login
      expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('This app is for admins only');
      // still nothing protected, now or ever, for this render
      expect(screen.queryByRole('heading', { name: heading })).toBeNull();
      unmount();
    }
  });
});

describe('Security: session invalidated server-side mid-action', () => {
  it('a 401 from a session revoked outside this app (real /auth/logout, different cookie, same admin) drops the app to /login, not a silent failure or stale success', async () => {
    const target = await makeUser('Deactivate Target'); // another user for the open admin session to act on
    const { cookie: otherCookie } = await loginApi(ADMIN); // a second, independent session for the same admin
    await session(ADMIN); // the UI's own session (jsdom cookie jar)

    renderApp('/users');
    const deactivateBtn = await screen.findByRole('button', { name: `Deactivate ${target.email}` });

    // invalidate the admin server-side without touching this app's own logout button or cookie jar:
    // tokenVersion is per-user, so bumping it via ANY session for this admin kills every outstanding token, including
    // the one the open UI is still holding, even though the UI's own copy of the cookie is untouched.
    await as(otherCookie).post('/auth/logout');

    // still on the open Users page: trigger an authenticated request with the now-dead session
    await userEvent.click(deactivateBtn);

    // must land on /login, not hang on the page or show a false "Inactive" success
    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Inactive')).toBeNull();
  });
});
