import { deny } from '@timber-js/app/server';

// Calls deny(401) — the 401.mdx in this segment should render.
export default function MdxDenyPage() {
  deny(401);
}
