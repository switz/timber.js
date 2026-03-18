import { redirect } from '@timber-js/app/server';

export default function PageRedirectTest() {
  redirect('/page-redirect-test/target');
}
