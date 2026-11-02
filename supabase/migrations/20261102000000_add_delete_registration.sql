-- Allow staff to delete a registration (and its orphaned attendee) from the app.
create or replace function public.delete_registration(p_registration_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare v_reg public.registrations%rowtype;
begin
 if not public.is_staff() then raise exception 'No autorizado'; end if;
 select * into v_reg from public.registrations where id=p_registration_id for update;
 if not found then raise exception 'Inscripción no encontrada'; end if;
 delete from public.check_ins where registration_id=v_reg.id;
 delete from public.registrations where id=v_reg.id;
 delete from public.attendees a where a.id=v_reg.attendee_id and not exists (select 1 from public.registrations r where r.attendee_id=a.id);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'registration_deleted','registration',v_reg.id::text,jsonb_build_object('activity_id',v_reg.activity_id));
end;
$$;

grant execute on function public.delete_registration(uuid) to authenticated;
notify pgrst, 'reload schema';
