/*
  # Fix function security issues

  1. Set immutable search_path on all functions to prevent search path manipulation attacks
  2. Revoke EXECUTE from anon and public roles on SECURITY DEFINER functions
  3. Grant EXECUTE only to authenticated role where needed (RLS helper functions)
  4. handle_new_user is only called by trigger, so revoke EXECUTE from all application roles
  5. update_updated_at is only called by trigger, so revoke EXECUTE from all application roles
*/

-- Fix search_path on all functions
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.get_my_workspace_role(uuid) SET search_path = public;
ALTER FUNCTION public.is_active_workspace_member(uuid) SET search_path = public;
ALTER FUNCTION public.can_write_in_workspace(uuid) SET search_path = public;
ALTER FUNCTION public.can_delete_in_workspace(uuid) SET search_path = public;
ALTER FUNCTION public.update_updated_at() SET search_path = public;

-- Revoke EXECUTE from public (which includes anon) on all SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_workspace_role(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.is_active_workspace_member(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.can_write_in_workspace(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.can_delete_in_workspace(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM public, anon, authenticated;

-- Grant EXECUTE on RLS helpers only to authenticated (needed for policy evaluation)
GRANT EXECUTE ON FUNCTION public.get_my_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_in_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_in_workspace(uuid) TO authenticated;
