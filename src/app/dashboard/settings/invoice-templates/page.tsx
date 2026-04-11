// Route moved to /dashboard/abrechnung/vorlagen in Phase 10 (unified Vorlagen editor).
import { permanentRedirect } from 'next/navigation';

export default function Page() {
  permanentRedirect('/dashboard/abrechnung/vorlagen');
}
