-- Horas que contam de cada tipo de turno (ex.: N 22h–09h conta 9h: 2h no dia da N + 7h na saída).
alter table public.shift_types add column paid_hours numeric(4, 2) check (paid_hours is null or (paid_hours > 0 and paid_hours <= 24));
update public.shift_types set paid_hours = 9 where code = 'N' and start_time = '22:00' and end_time = '09:00';
