begin;

grant usage on schema auth to psa_admin;
grant usage on schema auth to anon, authenticated, service_role;
grant all privileges on all tables in schema auth to psa_admin;
grant all privileges on all sequences in schema auth to psa_admin;
grant all privileges on all functions in schema auth to psa_admin;
grant execute on all functions in schema auth to anon, authenticated, service_role;

grant usage on schema public to psa_admin;
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to psa_admin;
grant all privileges on all sequences in schema public to psa_admin;
grant all privileges on all functions in schema public to psa_admin;

alter default privileges in schema auth grant all on tables to psa_admin;
alter default privileges in schema auth grant all on sequences to psa_admin;
alter default privileges in schema auth grant all on functions to psa_admin;

alter default privileges in schema public grant all on tables to psa_admin;
alter default privileges in schema public grant all on sequences to psa_admin;
alter default privileges in schema public grant all on functions to psa_admin;

commit;
