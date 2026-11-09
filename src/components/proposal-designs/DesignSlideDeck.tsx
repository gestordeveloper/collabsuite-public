import { SlideCanvas } from "./SlideCanvas";
import { PagedDeck, type DeckPage } from "./PagedDeck";
import { KIND_RENDERERS } from "./renderers";
import type { SlideEnvelope, ThemeTokens } from "@/src/lib/proposal-designs/types";
import { exportDeckToPdf } from "@/src/lib/proposal-designs/pdf-export";

interface Props {
  title: string;
  theme: ThemeTokens;
  slides: SlideEnvelope[];
}

export function DesignSlideDeck({ title, theme, slides }: Props) {
  const enabledSlides = slides.filter((s) => s.enabled);

  const pages: DeckPage[] = enabledSlides.map((slide) => {
    const Renderer = KIND_RENDERERS[slide.kind];
    return {
      id: slide.id,
      render: () => (
        <SlideCanvas className="max-w-[1600px] mx-auto">
          {Renderer ? (
            <Renderer data={slide.data} header={slide.header} tone={slide.tone} runningHeader={slide.runningHeader} theme={theme} />
          ) : null}
        </SlideCanvas>
      ),
    };
  });

  if (pages.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white/60 text-sm">
        Nenhum slide ativo nesta proposta.
      </div>
    );
  }

  const filename = `${title.replace(/\s+/g, "-").toLowerCase()}.pdf`;

  return (
    <PagedDeck
      pages={pages}
      title={title}
      variant="dark"
      onExport={() => exportDeckToPdf(slides, theme, filename)}
    />
  );
}
