import { screen } from '@testing-library/react';
import { renderApp } from './helpers';

test('renders the admin login page', async () => {
  renderApp('/login');
  expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
});
