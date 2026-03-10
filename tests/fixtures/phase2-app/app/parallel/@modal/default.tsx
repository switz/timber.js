/**
 * Modal default fallback — renders nothing when no modal is active.
 * The modal slot has no page.tsx for any route, so it always shows
 * this default (which renders null content).
 */
export default function ModalDefault() {
  return <div data-testid="modal-default" />;
}
