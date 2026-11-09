import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { PagedDeck, type DeckPage } from "@/src/components/proposal-designs/PagedDeck";
import { DesignSlideDeck } from "@/src/components/proposal-designs/DesignSlideDeck";
import type { SlideEnvelope, ThemeTokens } from "@/src/lib/proposal-designs/types";

interface ProposalData {
  task: {
    id: number;
    title: string;
    description?: string;
    content?: string;
    cover?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    due_at?: string;
    end_at?: string;
    estimated_time?: string;
    value?: string;
  };
  template: {
    id: number;
    name: string;
    cover: CoverData | null;
    about_company: AboutData | null;
    about_work: AboutData | null;
    values: ValuesData | null;
    thank_you: ThankYouData | null;
    styles: StyleData | null;
    design: string;
    theme: ThemeTokens | null;
    slides: SlideEnvelope[] | null;
  } | null;
}

interface CoverData {
  enabled: boolean;
  title: string;
  subtitle: string;
  backgroundImage: string;
  logoUrl: string;
  companyName: string;
  contactInfo: string;
  primaryColor: string;
}

interface AboutData {
  enabled: boolean;
  title: string;
  content: string;
  images?: Array<{ url: string; caption?: string }>;
}

interface ValuesData {
  enabled: boolean;
  title: string;
  description: string;
  items: Array<{ label: string; value: string; description: string }>;
  paymentInfo: string;
}

interface ThankYouData {
  enabled: boolean;
  title: string;
  message: string;
}

interface StyleData {
  fontFamily: string;
  primaryColor: string;
  secondaryColor: string;
}

/** Format date to Brazilian locale */
function fmtDate(dateStr?: string) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("pt-BR");
}

/** Propostas são documentos para o cliente: sempre claras, independente do tema do app. */
export function PublicProposalPage() {
  return (
    <div className="light min-h-screen bg-background text-foreground">
      <PublicProposalContent />
    </div>
  );
}

function PublicProposalContent() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/public/proposal/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Proposta não encontrada");
        return r.json();
      })
      .then((d: ProposalData) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center gap-3 text-muted-foreground">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        Carregando proposta...
      </div>
    );
  }

  if (error || !data || !data.template) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4 text-center px-4">
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-8 max-w-sm">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-1">Proposta não encontrada</h2>
          <p className="text-sm text-muted-foreground">{error ?? "Esta proposta pode ter expirado ou sido removida."}</p>
        </div>
      </div>
    );
  }

  const { task, template } = data;

  if (template.design && template.design !== "classic") {
    return <DesignSlideDeck title={template.name} theme={template.theme!} slides={template.slides!} />;
  }

  const styles = template.styles || { primaryColor: "#4f46e5", secondaryColor: "#64748b", fontFamily: "Inter, sans-serif" };

  // Build pages array from enabled sections
  const pages: DeckPage[] = [];

  if (template.cover?.enabled) {
    pages.push({
      id: "cover",
      render: () => <CoverPage cover={template.cover!} styles={styles} />,
    });
  }

  if (template.about_company?.enabled) {
    pages.push({
      id: "about-company",
      render: () => <ContentPage title={template.about_company!.title} content={template.about_company!.content} styles={styles} images={template.about_company!.images} />,
    });
  }

  if (template.about_work?.enabled) {
    pages.push({
      id: "about-work",
      render: () => <ContentPage title={template.about_work!.title} content={template.about_work!.content} styles={styles} task={task} />,
    });
  }

  if (template.values?.enabled) {
    pages.push({
      id: "values",
      render: () => <ValuesPage values={template.values!} styles={styles} task={task} />,
    });
  }

  if (template.thank_you?.enabled) {
    pages.push({
      id: "thank-you",
      render: () => <ThankYouPage thankYou={template.thank_you!} styles={styles} />,
    });
  }

  return <PagedDeck pages={pages} title={template.name} variant="light" />;
}

/* ── Cover Page ── */
function CoverPage({ cover, styles }: { cover: CoverData; styles: StyleData }) {
  return (
    <div className="a4-page print:min-h-0 print:h-[297mm]">
      <div
        className="relative min-h-[297mm] flex flex-col"
        style={{
          fontFamily: styles.fontFamily,
          backgroundColor: "#ffffff",
          backgroundImage: cover.backgroundImage ? `url(${cover.backgroundImage})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Overlay for readability if background image */}
        {cover.backgroundImage && (
          <div className="absolute inset-0 bg-black/40" />
        )}

        <div className="relative flex-1 flex flex-col items-center justify-center text-center px-12 py-16">
          {/* Logo */}
          {cover.logoUrl && (
            <img
              src={cover.logoUrl}
              alt="Logo"
              className="h-20 w-auto mb-8 object-contain"
              style={{ filter: cover.backgroundImage ? "brightness(0) invert(1)" : undefined }}
            />
          )}

          {/* Company Name */}
          <h1
            className="text-4xl md:text-5xl font-bold mb-2"
            style={{
              color: cover.backgroundImage ? "#ffffff" : cover.primaryColor || styles.primaryColor,
            }}
          >
            {cover.companyName}
          </h1>

          {/* Divider */}
          <div
            className="w-24 h-1 rounded-full my-6"
            style={{ backgroundColor: cover.primaryColor || styles.primaryColor }}
          />

          {/* Title */}
          <h2
            className="text-3xl md:text-4xl font-bold mb-3"
            style={{
              color: cover.backgroundImage ? "#ffffff" : "#1e293b",
            }}
          >
            {cover.title}
          </h2>

          {/* Subtitle */}
          {cover.subtitle && (
            <p
              className="text-lg md:text-xl max-w-lg"
              style={{
                color: cover.backgroundImage ? "rgba(255,255,255,0.85)" : "#64748b",
              }}
            >
              {cover.subtitle}
            </p>
          )}

          {/* Contact */}
          <div className="mt-auto pt-12">
            <p
              className="text-sm"
              style={{
                color: cover.backgroundImage ? "rgba(255,255,255,0.7)" : "#94a3b8",
              }}
            >
              {cover.contactInfo}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Content Page (About Company / About Work) ── */
function ContentPage({
  title,
  content,
  icon,
  styles,
  task,
  images,
}: {
  title: string;
  content: string;
  icon?: string;
  styles: StyleData;
  task?: ProposalData["task"];
  images?: Array<{ url: string; caption?: string }>;
}) {
  return (
    <div className="a4-page print:min-h-0 print:h-[297mm]">
      <div
        className="min-h-[297mm] flex flex-col p-12 md:p-16"
        style={{ fontFamily: styles.fontFamily, backgroundColor: "#ffffff" }}
      >
        <div className="mb-8">
          {icon && <span className="text-3xl">{icon}</span>}
          <h1
            className="text-3xl md:text-4xl font-bold mt-3"
            style={{ color: styles.primaryColor }}
          >
            {title}
          </h1>
          <div
            className="w-16 h-1 rounded-full mt-4"
            style={{ backgroundColor: styles.primaryColor }}
          />
        </div>

        <div
          className="prose prose-sm max-w-none mt-4 leading-relaxed whitespace-pre-wrap text-gray-700"
          dangerouslySetInnerHTML={{ __html: content }}
        />

        {/* Portfolio images */}
        {images && images.length > 0 && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            {images.filter((img) => img.url).map((img, idx) => (
              <div key={idx} className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                <img src={img.url} alt={img.caption || ""} className="w-full h-48 object-cover" />
                {img.caption && (
                  <p className="text-xs text-gray-500 text-center py-2 px-3">{img.caption}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Task info for about_work */}
        {task && title.toLowerCase().includes("trabalh") && (
          <div className="mt-auto pt-8 border-t border-gray-100">
            <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
              {task.estimated_time && (
                <div>
                  <span className="font-semibold text-gray-900">Tempo estimado:</span> {task.estimated_time}
                </div>
              )}
              {task.due_at && (
                <div>
                  <span className="font-semibold text-gray-900">Data de início:</span> {fmtDate(task.due_at)}
                </div>
              )}
              {task.end_at && (
                <div>
                  <span className="font-semibold text-gray-900">Data de entrega:</span> {fmtDate(task.end_at)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Values Page ── */
function ValuesPage({
  values,
  styles,
  task,
}: {
  values: ValuesData;
  styles: StyleData;
  task: ProposalData["task"];
}) {
  return (
    <div className="a4-page print:min-h-0 print:h-[297mm]">
      <div
        className="min-h-[297mm] flex flex-col p-12 md:p-16"
        style={{ fontFamily: styles.fontFamily, backgroundColor: "#ffffff" }}
      >
        <div className="mb-8">
          <h1
            className="text-3xl md:text-4xl font-bold mt-3"
            style={{ color: styles.primaryColor }}
          >
            {values.title}
          </h1>
          <div
            className="w-16 h-1 rounded-full mt-4"
            style={{ backgroundColor: styles.primaryColor }}
          />
        </div>

        {values.description && (
          <p className="text-gray-600 leading-relaxed mb-8">{values.description}</p>
        )}

        {/* Values table */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: styles.primaryColor }}>
                <th className="text-left px-5 py-3 font-semibold text-white">Item</th>
                <th className="text-left px-5 py-3 font-semibold text-white">Descrição</th>
                <th className="text-right px-5 py-3 font-semibold text-white">Valor</th>
              </tr>
            </thead>
            <tbody>
              {values.items.map((item, idx) => (
                <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{item.label}</td>
                  <td className="px-5 py-3 text-gray-600">{item.description}</td>
                  <td className="px-5 py-3 text-right font-semibold" style={{ color: styles.primaryColor }}>
                    {item.value}
                  </td>
                </tr>
              ))}
              {values.items.length > 1 && (
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={2} className="px-5 py-3 font-bold text-gray-900">Total</td>
                  <td className="px-5 py-3 text-right font-bold" style={{ color: styles.primaryColor }}>
                    {values.items.reduce((sum, item) => {
                      const num = parseFloat(item.value.replace(/[R$\s.,]/g, (m) => m === "," ? "." : ""));
                      return sum + (isNaN(num) ? 0 : num);
                    }, 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Payment info */}
        {values.paymentInfo && (
          <div className="mt-6 rounded-xl bg-gray-50 border border-gray-200 p-5">
            <h3 className="font-semibold text-sm text-gray-900 mb-1">Forma de Pagamento</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{values.paymentInfo}</p>
          </div>
        )}


      </div>
    </div>
  );
}

/* ── Thank You Page ── */
function ThankYouPage({ thankYou, styles }: { thankYou: ThankYouData; styles: StyleData }) {
  return (
    <div className="a4-page print:min-h-0 print:h-[297mm]">
      <div
        className="min-h-[297mm] flex flex-col items-center justify-center text-center p-12 md:p-16"
        style={{ fontFamily: styles.fontFamily, backgroundColor: "#ffffff" }}
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
          style={{ backgroundColor: `${styles.primaryColor}15` }}
        >
          <span className="text-4xl">🤝</span>
        </div>

        <h1
          className="text-4xl md:text-5xl font-bold mb-4"
          style={{ color: styles.primaryColor }}
        >
          {thankYou.title}
        </h1>

        <div
          className="w-16 h-1 rounded-full mb-6"
          style={{ backgroundColor: styles.primaryColor }}
        />

        <p
          className="text-lg text-gray-600 leading-relaxed max-w-lg whitespace-pre-wrap"
        >
          {thankYou.message}
        </p>


      </div>
    </div>
  );
}
