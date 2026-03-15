import { redirect } from '@timber/app/server';

export default function PageRedirectTest() {
  redirect('/page-redirect-test/target');
}
