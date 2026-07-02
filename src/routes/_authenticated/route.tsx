import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Use getSession() (local, offline-safe) instead of getUser() (network call).
    // getUser() intermittently fails on mobile / installed PWA cold starts and
    // was causing the app to bounce to /auth even for signed-in users.
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        throw redirect({
          to: "/auth",
          search: { redirect: location.href },
        });
      }
      return { user: data.session.user };
    } catch (err) {
      if (err && typeof err === "object" && "isRedirect" in err) throw err;
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
  },
  component: () => <Outlet />,
});