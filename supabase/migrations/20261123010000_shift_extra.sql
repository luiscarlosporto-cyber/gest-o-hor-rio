-- Turnos extra (trabalho suplementar): marcados a verde no horário SISQUAL.
alter table public.shift_days add column extra boolean not null default false;

-- Tipo T (tarde) para quem ainda não o tem
insert into public.shift_types (user_id, code, label, start_time, end_time, color, is_work, sort_order)
select p.id, 'T', 'Tarde', '15:00', '22:30', '#F8CBAD', true, 3
from public.profiles p
where not exists (select 1 from public.shift_types t where t.user_id = p.id and t.code = 'T');

-- Dados para calcular o vencimento (categoria, nível, horas semanais, feriado municipal)
alter table public.profiles add column pay_settings jsonb;
