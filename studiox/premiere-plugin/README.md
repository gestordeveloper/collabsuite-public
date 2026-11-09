# StudioX para Adobe Premiere Pro

Painel UXP que usa o StudioX (aberto no computador) para cortar silêncios, transcrever, revisar com IA e legendar,
e monta o resultado na timeline do Premiere.

## Como funciona
1. O painel manda o caminho do vídeo para `POST /api/premiere/process` do StudioX.
2. O StudioX devolve os cortes, as legendas e dois arquivos: `premiere.xml` (sequência já cortada) e `premiere.srt`.
3. O painel importa o XML (vira uma sequência) e as legendas (trilha de legendas).

## Sem o painel (já funciona)
    python premiere-plugin/export_xml.py "C:\videos\aula.mp4"
Gera `aula.studiox.xml` e `aula.studiox.srt` ao lado do vídeo. No Premiere: Arquivo > Importar.

## Instalar o painel (desenvolvimento)
1. Creative Cloud > Todos os aplicativos > instale o **UXP Developer Tool**.
2. Abra o StudioX e o Premiere Pro (25.6 ou mais novo).
3. No UXP Developer Tool: **Add Plugin** > escolha `premiere-plugin/manifest.json` > **Load**.
4. No Premiere: Janela > Extensões (UXP) > StudioX.

## Status
- Servidor (cortes, legendas, XML): testado com vídeo real e com vídeo sintético (transcrição falsa).
- XML no Premiere 2026: **funciona** (importa como sequência com os cortes certos, 67,98 s no teste, áudio nas 2 faixas).
- **Pendente:** vídeo de celular em pé (arquivo 1920x1080 com flag de rotação). O Premiere não aplica o flag ao importar
  o XML e as tentativas de corrigir com rotação no XML (0, +90, -90) ainda saíram de lado. Vídeo horizontal não tem esse problema.
- Painel UXP: **não carregou** no Premiere (o Premiere não se conecta ao UXP Developer Tool nesta máquina), então não foi testado.
