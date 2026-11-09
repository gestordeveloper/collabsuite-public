/**
 * Estilos visuais das imagens da Mini-novela HQ (escolhidos por série).
 *
 * Cada estilo define o que o gerador de imagens recebe (palavras-chave do estilo e o que evitar) e a direção que a IA de
 * texto segue ao escrever o prompt de cada slide. O estilo "graphic_novel" mantém o texto original de comic_art.md.
 */
export const DEFAULT_STYLE = "graphic_novel";

/** Texto comum a todos os estilos (vai no fim do que o gerador recebe): nada de texto dentro da imagem. */
export const NO_TEXT = "No text, no letters, no speech bubbles, no captions anywhere in the image.";
export const NO_TEXT_NEG = "text, letters, words, captions, speech bubbles, watermark, logo, signature";

export interface ComicStyle {
  label: string;
  frame: string;
  palette: string;
  suffix: string;
  negative: string;
  direction: string;
}

export const STYLES: Record<string, ComicStyle> = {
  graphic_novel: {
    label: "Graphic novel (HQ noir, nanquim)",
    frame: "comic panel",
    palette: "Color palette: dominant {base}, secondary {secondary}, warm accent {accent} only for emotional emphasis.",
    suffix:
      "graphic novel illustration, hand-drawn comic art, inked linework, cel-shaded coloring, visible brush strokes, " +
      "2D illustration, comic book panel, drawn artwork, illustrated style, NOT photography, NOT photorealistic, " +
      "NOT 3D render, in the style of Sin City graphic novel, Blacksad comic, Sean Murphy inking, Jock illustration, " +
      "Greg Capullo art, Mike Mignola shadows.",
    negative:
      "photography, photo, photorealistic, realistic skin, real person, 3D render, CGI, octane render, unreal engine, " +
      "hyperrealism, photographic texture, DSLR, portrait photography, live action, film still, movie screenshot, " +
      "stock photo, anime, manga, cartoon for kids, chibi, cheerful lighting, flat colors, oversaturated, lens flare, " +
      "clean studio lighting, white background, happy atmosphere, childish, pastel colors, low detail",
    direction: "", // usa comic_art.md
  },
  cinematic: {
    label: "Cinematográfico (live action, filme)",
    frame: "cinematic frame",
    palette: "Color grading guide: dominant {base}, secondary {secondary}, accent {accent} for emphasis.",
    suffix:
      "live-action photograph of real human actors, cinematic film still, photorealistic, real skin texture, shot on anamorphic lens, 35mm film, shallow depth of field, dramatic " +
      "motivated lighting, professional color grading, volumetric light, fine film grain, ultra detailed, " +
      "high-end feature film cinematography.",
    negative:
      "cartoon, illustration, drawing, painting, anime, comic, 3D render look, plastic skin, oversmoothed skin, " +
      "deformed hands, extra fingers, distorted face, low resolution, blurry, flat lighting, cheap stock photo look",
    direction:
      "ESTILO: fotografia cinematográfica realista, como um frame de filme de prestígio. Lente, enquadramento e luz " +
      "de cinema (anamórfica, profundidade de campo rasa, luz motivada, color grading consistente). Pessoas e " +
      "cenários realistas; nada de visual de desenho. Palavras-chave obrigatórias no prompt técnico: " +
      "`cinematic film still, photorealistic, anamorphic lens, shallow depth of field, dramatic lighting, color graded`.",
  },
  cartoon_2d: {
    label: "Cartoon 2D (desenho animado colorido)",
    frame: "cartoon frame",
    palette: "Color palette guide: dominant {base}, secondary {secondary}, accent {accent}; keep colors vivid and clean.",
    suffix:
      "2D cartoon illustration, bold clean outlines, flat vibrant colors with simple cel shading, expressive " +
      "characters, modern animated series style, smooth vector-like shapes, appealing character design.",
    negative:
      "photography, photorealistic, realistic skin, 3D render, CGI, live action, film still, sketchy lines, muddy colors, " +
      "dark grimy atmosphere, gore, low detail, blurry, deformed anatomy",
    direction:
      "ESTILO: desenho animado 2D moderno (série animada). Contornos limpos e grossos, cores chapadas vibrantes com " +
      "sombreamento simples (cel shading), personagens expressivos e carismáticos, cenários simplificados mas " +
      "claros. NÃO é foto, NÃO é 3D. Palavras-chave obrigatórias no prompt técnico: " +
      "`2D cartoon illustration, bold outlines, flat vibrant colors, cel shading, animated series style`.",
  },
  pixar_3d: {
    label: "3D estilo Pixar (animação em CGI)",
    frame: "animated film frame",
    palette: "Color palette guide: dominant {base}, secondary {secondary}, accent {accent}; warm, rich and appealing.",
    suffix:
      "3D animated feature film style, Pixar-like CGI render, stylized characters with big expressive eyes, soft " +
      "subsurface scattering skin, detailed fabric and hair, warm cinematic lighting, rich saturated colors, " +
      "polished studio animation quality.",
    negative:
      "photography, photorealistic human, real person, live action, 2D drawing, flat colors, sketch, anime, comic book " +
      "inking, uncanny valley, creepy face, scary, low poly, low detail, blurry, deformed anatomy",
    direction:
      "ESTILO: animação 3D de longa-metragem no estilo Pixar. Personagens estilizados com olhos grandes e expressivos, " +
      "proporções levemente exageradas, pele com subsurface scattering suave, cabelo e tecido detalhados, luz " +
      "quente e cinematográfica, cores ricas, cenários com acabamento de estúdio. NÃO é foto de pessoa real, NÃO é " +
      "desenho 2D. Palavras-chave obrigatórias no prompt técnico: " +
      "`3D animated movie style, Pixar-like CGI, stylized characters, expressive big eyes, soft subsurface scattering, warm cinematic lighting`.",
  },
  anime: {
    label: "Anime (estilo japonês)",
    frame: "anime key visual",
    palette: "Color palette guide: dominant {base}, secondary {secondary}, accent {accent}.",
    suffix:
      "anime key visual, high quality Japanese animation style, clean linework, cel shading with soft gradients, " +
      "detailed painted backgrounds, expressive eyes, dynamic composition, cinematic anime lighting.",
    negative:
      "photography, photorealistic, real person, 3D render, western comic style, heavy ink hatching, " +
      "deformed hands, extra fingers, low detail, blurry, muddy colors",
    direction:
      "ESTILO: anime japonês de alta qualidade (key visual de filme/série). Traço limpo, cel shading com degradês " +
      "suaves, cenários pintados com detalhe, olhos expressivos, composição dinâmica e luz cinematográfica de anime. " +
      "NÃO é foto, NÃO é 3D. Palavras-chave obrigatórias no prompt técnico: " +
      "`anime key visual, Japanese animation style, clean linework, cel shading, painted background, cinematic anime lighting`.",
  },
  watercolor: {
    label: "Aquarela (livro ilustrado)",
    frame: "storybook illustration",
    palette: "Color palette guide: dominant {base}, secondary {secondary}, accent {accent}; soft watercolor washes.",
    suffix:
      "watercolor storybook illustration, soft translucent washes, visible paper texture, delicate ink outlines, " +
      "hand-painted look, gentle color bleeding, warm and emotional atmosphere, children's book quality art.",
    negative:
      "photography, photorealistic, 3D render, CGI, digital sharp vector, harsh black outlines, neon colors, " +
      "low detail, blurry, deformed anatomy",
    direction:
      "ESTILO: ilustração em aquarela de livro ilustrado. Manchas translúcidas de cor, textura de papel visível, " +
      "contornos finos a tinta, sangramento suave de cor, clima emocional e acolhedor. NÃO é foto, NÃO é 3D. " +
      "Palavras-chave obrigatórias no prompt técnico: " +
      "`watercolor storybook illustration, soft washes, paper texture, delicate ink outlines, hand-painted`.",
  },
};

export const getStyle = (key: string): ComicStyle => STYLES[key] || STYLES[DEFAULT_STYLE];
export const styleOptions = () => Object.entries(STYLES).map(([id, v]) => ({ id, label: v.label }));

/** Cabeça do prompt da IA diretora de arte: o texto de HQ original, ou uma direção genérica para os outros estilos. */
export function artDirectorSystem(key: string, comicArtMd: string): string {
  const st = getStyle(key);
  if (!st.direction) return comicArtMd;
  return (
    "Você é um diretor de arte de narrativas visuais. Seu trabalho é receber o texto de cada slide de uma mini-novela em " +
    "carrossel e transformá-lo em um prompt de imagem detalhado e preciso para geração por IA, mantendo o MESMO estilo " +
    "visual em todos os slides.\n\n---\n\n## REGRA INEGOCIÁVEL DE ESTILO\n\n" + st.direction +
    "\n\nEssa regra vale para TODOS os slides e vence qualquer referência a quadrinhos que apareça no texto do slide.\n\n" +
    "## COMPOSIÇÃO E COERÊNCIA\n\n" +
    "- Regra dos terços, profundidade em camadas (primeiro plano, plano médio, fundo), enquadramentos variados: close " +
    "emocional, plano médio narrativo, plano aberto estabelecedor.\n" +
    "- Slide 1 é a capa: o personagem principal em pose marcante, atmosfera de máximo impacto, com topo e base livres.\n" +
    "- O mesmo personagem idêntico em todos os slides (traços, cabelo, roupa e proporções do character sheet); luz com " +
    "continuidade temporal e cor que evolui com a narrativa.\n" +
    "- Cada slide precisa de um conflito visual claro: o que se vê já conta metade da história.\n"
  );
}
