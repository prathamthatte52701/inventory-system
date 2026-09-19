import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/AuthContext';
import App from '../src/App';

test('renders the admin login page', async () => {
  render(<MemoryRouter initialEntries={['/login']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
});
