-- As funções de trigger não devem ser chamáveis pela API (aviso do Supabase Advisor).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
