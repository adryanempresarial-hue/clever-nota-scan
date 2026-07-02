import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Loader2, Sparkles, Cloud } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "Entrar · NOTA D4S" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = Route.useSearch();
  const goHome = () => {
    if (redirectTo && redirectTo.startsWith("/")) {
      window.location.href = redirectTo;
    } else {
      navigate({ to: "/" });
    }
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) goHome();
      else setChecking(false);
    }).catch(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handle = async (mode: "signin" | "signup") => {
    if (!email || !password) return toast.error("Preencha e-mail e senha");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Conta criada! Verifique seu e-mail se necessário.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      goHome();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    setLoading(true);
    try {
      const r = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + (redirectTo ?? "/"),
      });
      if (r.error) throw r.error;
      if (!r.redirected) goHome();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha no Google");
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-accent/30">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 px-4">
      <Toaster richColors position="top-right" />
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground font-bold mx-auto flex items-center justify-center">
            D4S
          </div>
          <h1 className="text-xl font-semibold flex items-center justify-center gap-2">
            NOTA <Sparkles className="w-4 h-4 text-primary" />
          </h1>
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
            <Cloud className="w-3.5 h-3.5" /> Sincroniza celular e computador na mesma conta
          </p>
        </div>

        <Button onClick={google} disabled={loading} variant="outline" className="w-full">
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Continuar com Google
        </Button>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> ou <div className="h-px flex-1 bg-border" />
        </div>

        <Tabs defaultValue="signin">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="signin">Entrar</TabsTrigger>
            <TabsTrigger value="signup">Criar conta</TabsTrigger>
          </TabsList>
          {(["signin", "signup"] as const).map((mode) => (
            <TabsContent key={mode} value={mode} className="space-y-3 pt-4">
              <div className="space-y-1">
                <Label htmlFor={`email-${mode}`}>E-mail</Label>
                <Input
                  id={`email-${mode}`}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`pwd-${mode}`}>Senha</Label>
                <Input
                  id={`pwd-${mode}`}
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button
                onClick={() => handle(mode)}
                disabled={loading}
                className="w-full"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {mode === "signin" ? "Entrar" : "Criar conta"}
              </Button>
            </TabsContent>
          ))}
        </Tabs>
      </Card>
    </div>
  );
}