// Route moved to /dashboard/abrechnung/rechnungsempfaenger in Phase 10.
// This redirect preserves existing bookmarks.
import { permanentRedirect } from 'next/navigation';

export default function Page() {
  permanentRedirect('/dashboard/abrechnung/rechnungsempfaenger');
}
