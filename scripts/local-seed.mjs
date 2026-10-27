import { fixtureEmails, fixturePassword, localAdmin, localQuery } from './local-utils.mjs';
const admin = localAdmin();
const listed = await admin.auth.admin.listUsers({ perPage: 100 });
if (listed.error) throw listed.error;
for (const email of fixtureEmails) {
  let user = listed.data.users.find(candidate => candidate.email === email);
  if (!user) { const created = await admin.auth.admin.createUser({ email, password: fixturePassword, email_confirm: true }); if (created.error) throw created.error; user = created.data.user; }
  if (!user) throw new Error('Local fixture creation failed.');
  if (email !== 'pending@reptilelink.test') localQuery(`update private.account_state set status='active',approved_at=now() where user_id='${user.id}'::uuid;`);
}
console.log('Local fixture accounts ready (4 active, 1 pending). No hosted project was used.');
