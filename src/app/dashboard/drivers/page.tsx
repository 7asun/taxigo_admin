import { redirect } from 'next/navigation';

// Permanent redirect: /dashboard/drivers was renamed to /dashboard/users
// as part of Approach B (unified company roster). Keep this file to
// preserve bookmarks and any hardcoded links in external systems.
export default function DriversRedirectPage() {
  redirect('/dashboard/users');
}
