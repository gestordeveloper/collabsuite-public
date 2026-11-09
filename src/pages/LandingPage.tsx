import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Bot, Calendar, CheckCircle2, CheckSquare, Clapperboard, Flame, FolderKanban, GalleryHorizontal, Headset, HeartPulse,
  Instagram, Lock, MessageCircle, Mic, NotebookPen, Palette, Share2, Terminal, Youtube, Music2, Github, ShieldCheck, Workflow,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";

const APP_NAME = "Collabsuite";

interface Feature {
  icon: LucideIcon;
  title: string;
  text: string;
}

const GROUPS: { id: string; title: string; subtitle: string; items: Feature[] }[] = [
  {
    id: "gestao",
    title: "Gestão do dia a dia",
    subtitle: "Tudo o que a equipe precisa para planejar, executar e acompanhar.",
    items: [
      { icon: FolderKanban, title: "Projetos e clientes", text: "Cada cliente é um projeto, com membros, funis, Kanban e painel próprio." },
      { icon: CheckSquare, title: "Tarefas e Kanban", text: "Tarefas com responsáveis, prazos, anexos, comentários e visualização em quadro." },
      { icon: Calendar, title: "Calendário", text: "Agenda única com tarefas, reuniões e postagens programadas. Arraste para reagendar." },
      { icon: NotebookPen, title: "Anotações e documentos", text: "Notas, planilhas, formulários públicos, propostas, fluxogramas e quadros brancos." },
      { icon: Flame, title: "Hábitos e rotinas", text: "Hábitos diários, rotinas do time, foco do dia e resumo semanal para manter o ritmo." },
      { icon: HeartPulse, title: "Saúde", text: "Registro de treinos, sono e medidas, com vínculo opcional aos seus hábitos." },
    ],
  },
  {
    id: "marketing",
    title: "Conteúdo e redes sociais",
    subtitle: "Crie, programe e publique sem pular de ferramenta em ferramenta.",
    items: [
      { icon: Share2, title: "Programação multi-rede", text: "Agende Instagram, YouTube Shorts, YouTube e TikTok na mesma tela, por cliente, e veja tudo no Calendário." },
      { icon: MessageCircle, title: "Engajamento no Instagram", text: "Responda comentários com palavras-chave e envie DMs automaticamente, com texto fixo ou gerado por IA." },
      { icon: GalleryHorizontal, title: "Estúdio de carrosséis", text: "Monte carrosséis com identidade visual da marca, ajuda de IA e exportação em PNG pronta para postar." },
      { icon: Clapperboard, title: "Editor de vídeo", text: "Corte, legende e finalize vídeos curtos sem sair da plataforma." },
      { icon: Palette, title: "Designs e Photosuite", text: "Editor visual com camadas, mesclas e modelos para criar peças e retocar imagens." },
      { icon: Workflow, title: "Mini-novelas em quadrinhos", text: "Histórias em HQ geradas com IA, com link de aprovação para o cliente." },
    ],
  },
  {
    id: "atendimento",
    title: "Atendimento e inteligência",
    subtitle: "Converse com clientes e deixe a IA cuidar do trabalho repetitivo.",
    items: [
      { icon: Headset, title: "Atendimento por WhatsApp", text: "Tickets, filas, atendentes e bot de triagem em um painel único." },
      { icon: Bot, title: "Agentes de IA", text: "Crie agentes com base de conhecimento, ferramentas e canais próprios — inclusive resposta automática no WhatsApp." },
      { icon: Mic, title: "Gravações com IA", text: "Transcreva reuniões, gere resumos e transforme decisões em tarefas." },
      { icon: Terminal, title: "Terminal e GitHub", text: "Acesso SSH auditado por projeto e integração com repositórios, PRs, issues e Actions." },
    ],
  },
];

function Section({ id, title, subtitle, children }: { id?: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <h2 className="font-display text-2xl font-bold sm:text-3xl">{title}</h2>
      {subtitle && <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{subtitle}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function LandingPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = `${APP_NAME} — gestão, atendimento e redes sociais em um só lugar`;
    const meta = document.querySelector('meta[name="description"]') ?? Object.assign(document.createElement("meta"), { name: "description" });
    meta.setAttribute("content", "Gerencie projetos e clientes, atenda pelo WhatsApp, use agentes de IA e programe posts no Instagram, YouTube e TikTok numa única plataforma.");
    if (!meta.parentElement) document.head.appendChild(meta);
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="min-h-screen overflow-y-auto bg-background text-foreground">
      {/* Cabeçalho */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center" aria-label={APP_NAME}>
            <div className="dynamic-color-img h-8 w-36" style={{ WebkitMaskImage: "url('/assets/images/logo.png')", maskImage: "url('/assets/images/logo.png')", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskSize: "contain", maskSize: "contain" }} />
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#recursos" className="hover:text-foreground">Recursos</a>
            <a href="#redes" className="hover:text-foreground">Redes sociais</a>
            <a href="#seguranca" className="hover:text-foreground">Segurança</a>
          </nav>
          <Button asChild size="sm"><Link to="/entrar">Entrar</Link></Button>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: "radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--primary) 18%, transparent), transparent 70%)" }} />
        <div className="mx-auto max-w-4xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Para agências, social media e times de marketing
          </span>
          <h1 className="mt-6 font-display text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Gestão, atendimento e redes sociais <span className="text-primary">em um só lugar</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            O {APP_NAME} reúne projetos, tarefas, calendário, WhatsApp, agentes de IA e a programação de posts no Instagram, YouTube e TikTok. Menos abas abertas, mais trabalho entregue.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg"><Link to="/entrar">Acessar a plataforma <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            <Button asChild size="lg" variant="outline"><a href="#recursos">Conhecer os recursos</a></Button>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Instagram className="h-4 w-4" /> Instagram</span>
            <span className="inline-flex items-center gap-1.5"><Youtube className="h-4 w-4" /> YouTube e Shorts</span>
            <span className="inline-flex items-center gap-1.5"><Music2 className="h-4 w-4" /> TikTok</span>
            <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-4 w-4" /> WhatsApp</span>
          </div>
        </div>
      </div>

      {/* Recursos */}
      <div id="recursos">
        {GROUPS.map((g) => (
          <Section key={g.id} id={g.id} title={g.title} subtitle={g.subtitle}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary" style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-base font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </Section>
        ))}
      </div>

      {/* Redes sociais */}
      <Section id="redes" title="Programe todas as redes de um lugar só" subtitle="Conecte a conta de cada cliente com segurança e publique no horário certo.">
        <div className="grid gap-4 lg:grid-cols-3">
          {[
            { icon: Instagram, name: "Instagram", points: ["Feed, carrosséis e Reels", "Respostas e DMs automáticas por palavra-chave", "Conexão via Facebook Login"] },
            { icon: Youtube, name: "YouTube e Shorts", points: ["Envio de vídeos e Shorts ao canal do cliente", "Título, descrição, tags e visibilidade", "Conexão via Google"] },
            { icon: Music2, name: "TikTok", points: ["Publicação direta ou envio ao rascunho", "Controle de privacidade, comentários, dueto e stitch", "Conexão via TikTok Login"] },
          ].map(({ icon: Icon, name, points }) => (
            <div key={name} className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2.5">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="font-display text-base font-semibold">{name}</h3>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {points.map((p) => (
                  <li key={p} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-5 max-w-3xl text-sm text-muted-foreground">
          O {APP_NAME} só acessa as contas que você autorizar e só publica o que você programar. Você pode desconectar qualquer rede quando quiser, na plataforma ou nas configurações da própria rede.
        </p>
      </Section>

      {/* Como funciona */}
      <Section title="Como funciona">
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            ["1", "Crie o projeto do cliente", "Convide a equipe e organize tarefas, arquivos e conversas por cliente."],
            ["2", "Conecte as contas", "Autorize Instagram, YouTube e TikTok do cliente com o login oficial de cada rede."],
            ["3", "Programe e acompanhe", "Agende os posts, veja tudo no Calendário e receba aviso quando for publicado."],
          ].map(([n, t, d]) => (
            <li key={n} className="rounded-2xl border border-border bg-card p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">{n}</span>
              <h3 className="mt-4 font-display text-base font-semibold">{t}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Segurança */}
      <Section id="seguranca" title="Seus dados e os dos seus clientes protegidos">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: Lock, t: "Tokens criptografados", d: "Os acessos às redes sociais ficam criptografados e nunca são exibidos na tela." },
            { icon: ShieldCheck, t: "Acesso por projeto", d: "Cada pessoa só enxerga os clientes e contas dos projetos de que participa." },
            { icon: Github, t: "Você no controle", d: "Desconecte uma rede a qualquer momento e peça a exclusão dos seus dados quando quiser." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-2xl border border-border bg-card p-5">
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-display text-base font-semibold">{t}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* CTA final */}
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="rounded-3xl border border-border bg-card px-6 py-12 text-center" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 14%, hsl(var(--card))), hsl(var(--card)))" }}>
          <h2 className="font-display text-2xl font-bold sm:text-3xl">Pronto para centralizar o trabalho da sua equipe?</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">Acesse a plataforma e comece a organizar clientes, conteúdo e atendimento hoje.</p>
          <Button asChild size="lg" className="mt-6"><Link to="/entrar">Entrar ou criar conta <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
        </div>
      </div>

      {/* Rodapé */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} {APP_NAME}. Todos os direitos reservados.</span>
          <nav className="flex gap-5">
            <Link to="/privacidade" className="hover:text-foreground">Política de Privacidade</Link>
            <Link to="/termos" className="hover:text-foreground">Termos de Uso</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
