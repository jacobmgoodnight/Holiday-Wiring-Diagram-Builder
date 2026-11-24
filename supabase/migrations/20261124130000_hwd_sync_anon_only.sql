-- The sync app never signs in: only the public (anon) key calls the hwd_ functions.
revoke execute on function public.hwd_pull(text) from authenticated;
revoke execute on function public.hwd_push(text, bigint, text) from authenticated;
revoke execute on function public.hwd_photo_ids(text) from authenticated;
revoke execute on function public.hwd_photo_put(text, text, text) from authenticated;
revoke execute on function public.hwd_photo_get(text, text) from authenticated;
revoke execute on function public.hwd_forget(text) from authenticated;
