-- Add optional seat assignment to registrations in an existing Supabase project.
alter table public.registrations add column if not exists seat_row text check (seat_row is null or length(trim(seat_row)) between 1 and 40);
alter table public.registrations add column if not exists seat_number text check (seat_number is null or length(trim(seat_number)) between 1 and 40);

drop function if exists public.register_attendee(uuid,text,text,text);
create or replace function public.register_attendee(
 p_activity_id uuid, p_full_name text, p_email text default null, p_organization text default null,
 p_seat_row text default null, p_seat_number text default null
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_attendee uuid; v_registration uuid; v_token uuid; v_status text;
begin
 if not public.is_staff() then raise exception 'No autorizado'; end if;
 if length(trim(coalesce(p_full_name,'')))=0 then raise exception 'El nombre es obligatorio'; end if;
 if length(trim(coalesce(p_seat_row,'')))>40 or length(trim(coalesce(p_seat_number,'')))>40 then raise exception 'La fila y el asiento admiten hasta 40 caracteres'; end if;
 select status into v_status from public.activities where id=p_activity_id for share;
 if not found then raise exception 'Actividad no encontrada'; end if;
 if v_status<>'open' then raise exception 'La actividad está cerrada'; end if;
 insert into public.attendees(full_name,email,organization) values(trim(p_full_name),nullif(trim(p_email),''),nullif(trim(p_organization),'')) returning id into v_attendee;
 insert into public.registrations(activity_id,attendee_id,seat_row,seat_number,created_by)
 values(p_activity_id,v_attendee,nullif(trim(p_seat_row),''),nullif(trim(p_seat_number),''),auth.uid())
 returning id,qr_token into v_registration,v_token;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'registration_created','registration',v_registration::text,jsonb_build_object('activity_id',p_activity_id));
 return jsonb_build_object('registration_id',v_registration,'qr_token',v_token);
exception when unique_violation then
 raise exception 'Posible inscripción duplicada para esta persona y actividad. Revise el listado antes de volver a intentarlo.';
end;
$$;

grant execute on function public.register_attendee(uuid,text,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
