import type { SlideEnvelope } from "./types";

/**
 * Modelo 2 — default slide content. Generic placeholder copy, editorial
 * structure with chapter dividers (like the reference deck), but without
 * the fictional client content.
 */
export const MODEL2_SLIDES: SlideEnvelope[] = [
  {
    id: "m2-01-capa",
    kind: "cover",
    label: "01 · Capa",
    enabled: true,
    tone: "light",
    runningHeader: { left: "Sua Empresa", right: "Proposta comercial" },
    data: {
      layout: "panorama-bottom",
      kicker: "Nome do Cliente",
      headline: "Alcançar o resultado\nem poucos dias",
      headlineHighlight: "poucos dias",
      body: "Descreva em uma frase o pacote de valor central desta proposta.",
      image: { url: "", alt: "Imagem panorâmica (loja, produto ou time)" },
      footerRows: [
        { label: "Responsável", value: "Nome · Cargo" },
        { label: "Validade", value: "30 dias" },
        { label: "Documento", value: "PROP-0000 · confidencial" },
      ],
    },
  },
  {
    id: "m2-02-resumo",
    kind: "two-column-split",
    label: "02 · Resumo executivo",
    enabled: true,
    tone: "dark",
    runningHeader: { left: "Resumo executivo", right: "02" },
    header: { title: "Em quatro frases" },
    data: {
      left: {
        type: "numbered-rows",
        title: "",
        data: {
          rows: [
            { number: "01", title: "", text: "Resuma o problema em uma frase." },
            { number: "02", title: "", text: "Resuma a solução proposta." },
            { number: "03", title: "", text: "Resuma prazo e formato de entrega." },
            { number: "04", title: "", text: "Resuma o investimento." },
          ],
        },
      },
      right: {
        type: "stat-grid",
        title: "",
        noteText: "Conteúdo detalhado nos capítulos seguintes deste documento.",
        data: {
          columns: 1,
          cards: [
            { value: "00/00/0000", label: "Início previsto", tone: "accent" },
            { value: "0 meses", label: "Duração", tone: "outline" },
            { value: "0 pessoas", label: "Squad", tone: "outline" },
            { value: "0", label: "Frentes", tone: "outline" },
          ],
        },
      },
    },
  },
  {
    id: "m2-03-divisor-contexto",
    kind: "chapter-divider",
    label: "03 · Divisor · Contexto",
    enabled: true,
    tone: "dark",
    data: {
      kicker: "Capítulo 01",
      title: "Contexto e\ndiagnóstico",
      body: "O que ouvimos do cliente e o que encontramos na análise inicial.",
      image: { url: "", alt: "Imagem de apoio" },
    },
  },
  {
    id: "m2-04-desafio",
    kind: "card-grid",
    label: "04 · O desafio",
    enabled: true,
    tone: "light",
    runningHeader: { left: "Capítulo 01 · Contexto", right: "04" },
    header: {
      introQuote: {
        text: "Descreva aqui, com as palavras do cliente, a dor que motivou este projeto.",
        attribution: "Cargo · Empresa, entrevista de 00/00/0000",
      },
    },
    data: {
      columns: 3,
      cards: [
        { kicker: "Ponto 1", text: "Descreva o primeiro ponto do desafio.", tone: "light" },
        { kicker: "Ponto 2", text: "Descreva o segundo ponto do desafio.", tone: "light" },
        { kicker: "Ponto 3", text: "Descreva o terceiro ponto do desafio.", tone: "dark" },
      ],
    },
  },
  {
    id: "m2-05-oportunidades",
    kind: "numbered-rows",
    label: "05 · Oportunidades",
    enabled: true,
    tone: "light",
    runningHeader: { left: "Capítulo 01 · Diagnóstico", right: "05" },
    header: { title: "Onde está\no ganho", intro: "Três movimentos, na ordem em que se pagam." },
    data: {
      rows: [
        { number: "01", title: "Oportunidade 1", text: "Descreva a ação proposta.", resultText: "Descreva o ganho esperado.", statValue: "0%", statLabel: "indicador" },
        { number: "02", title: "Oportunidade 2", text: "Descreva a ação proposta.", resultText: "Descreva o ganho esperado.", statValue: "0", statLabel: "indicador" },
        { number: "03", title: "Oportunidade 3", text: "Descreva a ação proposta.", resultText: "Descreva o ganho esperado.", statValue: "0", statLabel: "indicador" },
      ],
    },
  },
  {
    id: "m2-06-divisor-solucao",
    kind: "chapter-divider",
    label: "06 · Divisor · Solução",
    enabled: true,
    tone: "dark",
    data: {
      kicker: "Capítulo 02",
      title: "Solução e\nexecução",
      body: "Como vamos resolver, com que método e em quanto tempo.",
      image: { url: "", alt: "Imagem de apoio" },
    },
  },
  {
    id: "m2-07-escopo",
    kind: "card-grid",
    label: "07 · Escopo",
    enabled: true,
    tone: "light",
    runningHeader: { left: "Capítulo 02 · Escopo", right: "07" },
    header: { title: "Frentes de\ntrabalho" },
    data: {
      columns: 2,
      cards: [
        { number: "01", title: "Frente 1", text: "Descreva o que será feito.", tone: "light" },
        { number: "02", title: "Frente 2", text: "Descreva o que será feito.", tone: "light" },
        { number: "03", title: "Frente 3", text: "Descreva o que será feito.", tone: "light" },
        { number: "04", title: "Frente 4", text: "Descreva o que será feito.", tone: "dark" },
      ],
      footnote: { label: "Fora do escopo:", text: "Descreva aqui o que não está incluso nesta proposta." },
    },
  },
  {
    id: "m2-08-metodo-cronograma",
    kind: "method-timeline",
    label: "08 · Método e cronograma",
    enabled: true,
    tone: "dark",
    runningHeader: { left: "Capítulo 02 · Execução", right: "08" },
    header: { title: "Como e\nquando", intro: "Descreva o ritmo de entregas e as decisões do cliente em cada ciclo." },
    data: {
      steps: [
        { number: "01", title: "Etapa 1", text: "Descrição da etapa." },
        { number: "02", title: "Etapa 2", text: "Descrição da etapa." },
        { number: "03", title: "Etapa 3", text: "Descrição da etapa." },
        { number: "04", title: "Etapa 4", text: "Descrição da etapa." },
        { number: "05", title: "Etapa 5", text: "Descrição da etapa.", tone: "accent" },
      ],
      phases: [
        { dateLabel: "Mês 1 — 3", title: "Fase 1", detail: "Descreva as entregas.", widthPct: 50, offsetPct: 0, tone: "light" },
        { dateLabel: "Mês 4 — 7", title: "Fase 2", detail: "Descreva as entregas.", widthPct: 74, offsetPct: 14, tone: "accent" },
        { dateLabel: "Mês 8 — 9", title: "Fase 3", detail: "Descreva as entregas.", widthPct: 42, offsetPct: 58, tone: "outline" },
      ],
    },
  },
  {
    id: "m2-09-time-stack",
    kind: "two-column-split",
    label: "09 · Time e stack",
    enabled: true,
    tone: "light",
    runningHeader: { left: "Capítulo 02 · Time e tecnologia", right: "09" },
    data: {
      left: {
        type: "team-grid",
        title: "Squad dedicado",
        noteText: "Ponto único de contato: a gerência de projeto responde pelos prazos.",
        data: {
          columns: 2,
          members: [
            { name: "Nome 1", role: "Cargo · dedicação", photo: { url: "", alt: "Foto" } },
            { name: "Nome 2", role: "Cargo · dedicação", photo: { url: "", alt: "Foto" } },
            { name: "Nome 3", role: "Cargo · dedicação", photo: { url: "", alt: "Foto" } },
            { name: "Nome 4", role: "Cargo · dedicação", photo: { url: "", alt: "Foto" } },
            { name: "Nome 5", role: "Cargo · dedicação", photo: { url: "", alt: "Foto" }, tone: "dark" },
          ],
        },
      },
      right: {
        type: "card-grid",
        title: "Stack",
        noteText: "Sem dependência da agência: todo o código fica em repositório do cliente.",
        data: {
          columns: 1,
          cards: [
            { title: "Categoria 1", text: "Liste as tecnologias." },
            { title: "Categoria 2", text: "Liste as tecnologias." },
            { title: "Categoria 3", text: "Liste as tecnologias." },
            { title: "Categoria 4", text: "Liste as tecnologias." },
          ],
        },
      },
    },
  },
  {
    id: "m2-10-divisor-investimento",
    kind: "chapter-divider",
    label: "10 · Divisor · Investimento",
    enabled: true,
    tone: "dark",
    data: {
      kicker: "Capítulo 03",
      title: "Investimento\ne acordo",
      body: "Valores por fase, fee de sustentação e condições comerciais completas.",
      image: { url: "", alt: "Imagem de apoio" },
    },
  },
  {
    id: "m2-11-investimento",
    kind: "pricing-breakdown",
    label: "11 · Investimento",
    enabled: true,
    tone: "light",
    runningHeader: { left: "Capítulo 03 · Investimento", right: "11" },
    header: { title: "Projeto por fase\n+ sustentação" },
    data: {
      layout: "table",
      mainKicker: "",
      rows: [
        { label: "Fase 1", detail: "Descreva as entregas.", hours: "0h", price: "R$ 0" },
        { label: "Fase 2", detail: "Descreva as entregas.", hours: "0h", price: "R$ 0" },
        { label: "Fase 3", detail: "Descreva as entregas.", hours: "0h", price: "R$ 0" },
      ],
      totalLabel: "Total do projeto",
      totalHours: "0h",
      totalPrice: "R$ 0",
      paymentNote: "Descreva as condições de pagamento.",
      feeKicker: "Sustentação mensal",
      feePrice: "R$ 0",
      feeSuffix: "/mês",
      feeDetail: "Descreva o que está incluso na sustentação mensal.",
      noteTitle: "Hora extra de squad",
      noteText: "R$ 0/h para demandas acima do pacote, aprovadas caso a caso.",
      footerNote: "Valores líquidos · reajuste anual · proposta válida por 30 dias.",
    },
  },
  {
    id: "m2-12-pacotes",
    kind: "pricing-tiers",
    label: "12 · Pacotes (opção)",
    enabled: false,
    tone: "light",
    runningHeader: { left: "Capítulo 03 · Investimento · alternativa", right: "12" },
    header: { title: "Se preferir por pacote" },
    data: {
      tiers: [
        { name: "Essencial", text: "Descrição do pacote.", price: "R$ 0", period: "projeto · 0 meses", features: ["Item 1", "Item 2"] },
        { name: "Pro", text: "Descrição do pacote.", price: "R$ 0", period: "projeto · 0 meses", features: ["Item 1", "Item 2", "Item 3"], recommended: true, badgeLabel: "Recomendado" },
        { name: "Enterprise", text: "Descrição do pacote.", price: "R$ 0", period: "projeto · 0 meses", features: ["Item 1", "Item 2"] },
      ],
      footerNotes: [],
    },
  },
  {
    id: "m2-13-cases",
    kind: "cases-grid",
    label: "13 · Cases",
    enabled: true,
    tone: "dark",
    runningHeader: { left: "Capítulo 03 · Prova", right: "13" },
    header: { title: "Já fizemos\nisso antes" },
    data: {
      layout: "image-left",
      cases: [
        {
          image: { url: "", alt: "Print do projeto" },
          title: "Nome do case 1",
          text: "Descreva o que foi feito e o resultado alcançado.",
          stats: [{ value: "+0%", label: "indicador 1" }, { value: "-0%", label: "indicador 2" }],
        },
        {
          image: { url: "", alt: "Print do projeto" },
          title: "Nome do case 2",
          text: "Descreva o que foi feito e o resultado alcançado.",
          stats: [{ value: "0", label: "indicador 1" }, { value: "0", label: "indicador 2" }],
        },
      ],
    },
  },
  {
    id: "m2-14-kpis-termos",
    kind: "two-column-split",
    label: "14 · KPIs e termos",
    enabled: true,
    tone: "light",
    runningHeader: { left: "Capítulo 03 · Acordo", right: "14" },
    data: {
      left: {
        type: "stat-grid",
        title: "Metas e governança",
        data: {
          columns: 2,
          cards: [
            { value: "+0%", label: "Indicador 1", tone: "dark" },
            { value: "0 d", label: "Indicador 2", tone: "mid" },
            { value: "0 h", label: "Indicador 3", tone: "light" },
            { value: "0%", label: "Indicador 4", tone: "light" },
          ],
          notes: [
            { title: "Semanal", text: "Status de 30 minutos." },
            { title: "Quinzenal", text: "Demo da sprint." },
            { title: "Trimestral", text: "Revisão de KPIs." },
          ],
        },
      },
      right: {
        type: "card-grid",
        title: "Termos e condições",
        data: {
          columns: 2,
          cards: [
            { title: "Propriedade intelectual", text: "Descreva a cláusula." },
            { title: "Mudanças de escopo", text: "Descreva a cláusula." },
            { title: "Responsabilidades do cliente", text: "Descreva a cláusula." },
            { title: "Garantia", text: "Descreva a cláusula." },
            { title: "Confidencialidade e LGPD", text: "Descreva a cláusula." },
            { title: "Rescisão", text: "Descreva a cláusula." },
          ],
        },
      },
    },
  },
  {
    id: "m2-15-aceite",
    kind: "closing-acceptance",
    label: "15 · Aceite",
    enabled: true,
    tone: "dark",
    runningHeader: { left: "Sua Empresa", right: "15" },
    data: {
      title: "Vamos\ncomeçar",
      steps: [
        { number: "1", text: "Descreva o primeiro passo." },
        { number: "2", text: "Descreva o segundo passo." },
        { number: "3", text: "Descreva o terceiro passo." },
      ],
      footerContact: "email@suaempresa.com · (00) 00000-0000 · suaempresa.com.br",
      acceptanceKicker: "Aceite da proposta",
      acceptanceText: "Ao assinar, as partes concordam com o escopo, prazos, valores e condições descritos neste documento.",
      signers: [
        { party: "Nome do Cliente", detail: "Nome, cargo e data" },
        { party: "Sua Empresa", detail: "Nome do responsável · Cargo" },
      ],
      footerNote: "Modelo de investimento escolhido: ☐ Por fase   ☐ Pacote",
    },
  },
];
