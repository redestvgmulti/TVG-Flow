-- Allow authenticated users (or admins) to create new departments
create policy "Allow insert for authenticated users"
on "public"."departamentos"
as permissive
for insert
to authenticated
with check (true);

-- Also ensure update/delete are possible if not already covered
create policy "Allow update for authenticated users"
on "public"."departamentos"
as permissive
for update
to authenticated
using (true)
with check (true);

create policy "Allow delete for authenticated users"
on "public"."departamentos"
as permissive
for delete
to authenticated
using (true);
