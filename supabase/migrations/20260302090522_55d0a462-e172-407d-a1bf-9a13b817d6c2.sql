INSERT INTO public.user_roles (user_id, role)
VALUES ('734bd05c-a381-4267-b823-88a84c79a40e', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;