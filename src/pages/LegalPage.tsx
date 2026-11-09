import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// ── Edite aqui os dados que aparecem nas páginas ────────────────────────────────
const APP_NAME = "Collabsuite";
const CONTACT_EMAIL = "contato.gebenezer@gmail.com";
const UPDATED_AT = "7 de novembro de 2026";
// ────────────────────────────────────────────────────────────────────────────────

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">{children}</a>
);
const H = ({ children, id }: { children: ReactNode; id?: string }) => <h2 id={id} className="mt-8 font-display text-lg font-bold">{children}</h2>;
const P = ({ children }: { children: ReactNode }) => <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>;
const L = ({ items }: { items: ReactNode[] }) => (
  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
    {items.map((i, k) => <li key={k}>{i}</li>)}
  </ul>
);

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <nav className="mb-8 flex flex-wrap items-center gap-4 text-sm">
          <Link to="/" className="font-display font-bold">{APP_NAME}</Link>
          <Link to="/privacidade" className="text-muted-foreground hover:text-foreground">Política de Privacidade</Link>
          <Link to="/termos" className="text-muted-foreground hover:text-foreground">Termos de Uso</Link>
        </nav>
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">Última atualização: {UPDATED_AT}</p>
        {children}
        <p className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">Dúvidas? Fale com a gente em <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </div>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <Shell title="Política de Privacidade">
      <P>
        Esta política explica como o {APP_NAME} ("nós", "plataforma") coleta, usa, armazena e protege os dados de quem usa a plataforma, em conformidade com a Lei Geral de Proteção de Dados (LGPD – Lei 13.709/2018).
        O {APP_NAME} é uma plataforma de gestão de projetos, atendimento e marketing que permite, entre outras coisas, planejar e publicar conteúdos em redes sociais (Instagram, YouTube e TikTok) em nome dos nossos usuários e dos clientes deles.
      </P>

      <H>1. Dados que coletamos</H>
      <L items={[
        <><strong>Dados de cadastro:</strong> nome, e-mail, telefone e senha (armazenada de forma criptografada).</>,
        <><strong>Conteúdo que você cria na plataforma:</strong> projetos, tarefas, legendas, imagens, vídeos e agendamentos de postagens.</>,
        <><strong>Dados das contas de redes sociais que você conecta</strong> (veja a seção 3): identificador da conta, nome de exibição, foto de perfil e tokens de acesso autorizados por você.</>,
        <><strong>Dados técnicos:</strong> endereço IP, tipo de navegador e registros de acesso, usados para segurança e para o funcionamento do serviço.</>,
      ]} />

      <H>2. Como usamos os dados</H>
      <L items={[
        "Prestar o serviço: autenticar você, organizar seu trabalho e executar as publicações que você programar.",
        "Publicar, agendar e acompanhar postagens nas redes sociais conectadas, somente quando você solicita.",
        "Enviar notificações do sistema (por exemplo, \"postagem publicada\" ou \"falha ao publicar\").",
        "Garantir a segurança, prevenir fraudes e cumprir obrigações legais.",
      ]} />
      <P>Não vendemos seus dados pessoais, não os usamos para publicidade de terceiros e não os compartilhamos com terceiros além do necessário para prestar o serviço.</P>

      <H id="redes-sociais">3. Contas de redes sociais conectadas</H>
      <P>Ao conectar uma conta, você autoriza o {APP_NAME} a agir em seu nome apenas nas permissões que você aceitar na tela de autorização da própria rede social. Guardamos os tokens de acesso criptografados e os usamos exclusivamente para as funções descritas abaixo.</P>
      <L items={[
        <><strong>Instagram / Facebook (Meta):</strong> publicar fotos, carrosséis e Reels programados; ler comentários das publicações para executar respostas automáticas e mensagens diretas que você configurar. O uso segue as <A href="https://developers.facebook.com/terms">Termos da Plataforma Meta</A>.</>,
        <><strong>YouTube (Google):</strong> enviar vídeos e Shorts ao seu canal e ler dados básicos do canal (nome e foto). O {APP_NAME} usa os serviços de API do YouTube e, por isso, você também concorda com os <A href="https://www.youtube.com/t/terms">Termos de Serviço do YouTube</A> e com a <A href="https://policies.google.com/privacy">Política de Privacidade do Google</A>. O uso e a transferência de informações recebidas das APIs do Google seguem a <A href="https://developers.google.com/terms/api-services-user-data-policy">Política de Dados do Usuário dos Serviços de API do Google</A>, incluindo os requisitos de Uso Limitado.</>,
        <><strong>TikTok:</strong> enviar vídeos para a sua conta (publicação direta ou rascunho) e ler seu nome e foto de perfil. O uso segue os <A href="https://www.tiktok.com/legal/page/global/terms-of-service/pt">Termos de Serviço do TikTok</A> e a <A href="https://www.tiktok.com/legal/page/row/privacy-policy/pt">Política de Privacidade do TikTok</A>.</>,
      ]} />
      <P>Não usamos os dados obtidos dessas redes para treinar modelos de inteligência artificial de uso geral, não os vendemos e não os transferimos a terceiros, salvo para prestar o serviço que você solicitou, cumprir a lei ou com o seu consentimento.</P>
      <P>
        <strong>Como revogar o acesso:</strong> você pode desconectar a conta a qualquer momento em Redes sociais → Contas dentro do {APP_NAME}, ou diretamente na rede:
        {" "}<A href="https://myaccount.google.com/permissions">permissões da Conta Google</A> (YouTube),
        {" "}<A href="https://www.facebook.com/settings?tab=business_tools">integrações comerciais do Facebook</A> (Instagram) e
        {" "}Configurações → Segurança e permissões → Apps e serviços no TikTok.
        Ao desconectar, apagamos os tokens de acesso armazenados.
      </P>

      <H>4. Compartilhamento</H>
      <P>Compartilhamos dados somente com: (a) as redes sociais que você conectou, para executar as ações solicitadas; (b) provedores de infraestrutura (hospedagem, armazenamento de arquivos, envio de e-mail) que operam sob contrato e apenas para nos prestar serviço; (c) autoridades, quando exigido por lei.</P>

      <H>5. Armazenamento e segurança</H>
      <P>Adotamos medidas técnicas e organizacionais para proteger os dados: comunicação criptografada (HTTPS), senhas protegidas por hash, tokens de redes sociais criptografados em repouso e controle de acesso por projeto. Nenhum sistema é 100% seguro, mas trabalhamos para reduzir riscos e corrigir incidentes rapidamente.</P>

      <H>6. Retenção</H>
      <P>Mantemos seus dados enquanto sua conta estiver ativa ou pelo tempo necessário para prestar o serviço e cumprir obrigações legais. Vídeos e imagens enviados para publicação podem ser removidos por você a qualquer momento.</P>

      <H id="exclusao-de-dados">7. Seus direitos e exclusão de dados</H>
      <P>Nos termos da LGPD, você pode solicitar confirmação de tratamento, acesso, correção, anonimização, portabilidade, informação sobre compartilhamento e a <strong>exclusão dos seus dados pessoais</strong>, além de revogar consentimentos.</P>
      <P>
        <strong>Para excluir seus dados:</strong> envie um e-mail para <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}?subject=Exclus%C3%A3o%20de%20dados`}>{CONTACT_EMAIL}</a> com o assunto "Exclusão de dados", informando o e-mail da sua conta.
        Atendemos o pedido em até 15 dias. Se você só quer remover os dados de uma rede social, basta desconectá-la em Redes sociais → Contas (apagamos os tokens) e, se desejar, revogar o acesso na própria rede.
      </P>

      <H>8. Cookies e armazenamento local</H>
      <P>Usamos armazenamento local do navegador para manter você autenticado e lembrar preferências de uso (como filtros e tema). Não usamos cookies de publicidade.</P>

      <H>9. Crianças</H>
      <P>A plataforma não é destinada a menores de 18 anos e não coletamos intencionalmente dados de crianças.</P>

      <H>10. Alterações nesta política</H>
      <P>Podemos atualizar esta política. Quando houver mudanças relevantes, avisaremos na plataforma e atualizaremos a data no topo desta página.</P>

      <H>11. Contato</H>
      <P>Controlador e encarregado de dados: {APP_NAME} — <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</P>
    </Shell>
  );
}

export function TermsPage() {
  return (
    <Shell title="Termos de Uso">
      <P>Ao criar uma conta ou usar o {APP_NAME} ("plataforma"), você concorda com estes Termos de Uso. Se não concordar, não utilize o serviço.</P>

      <H>1. O serviço</H>
      <P>O {APP_NAME} é uma plataforma de gestão de projetos, tarefas, atendimento e marketing, que inclui ferramentas para criar, programar e publicar conteúdos em redes sociais (Instagram, YouTube e TikTok) e automatizar interações no Instagram.</P>

      <H>2. Conta e responsabilidades</H>
      <L items={[
        "Você deve fornecer informações verdadeiras e manter sua senha em sigilo. Você é responsável por toda atividade realizada na sua conta.",
        "Você declara ter capacidade legal e autorização para usar a plataforma e para conectar as contas de redes sociais (suas ou de clientes) que adicionar.",
        "Se usa a plataforma em nome de clientes, você é responsável por obter a autorização deles para acessar e publicar em suas contas.",
      ]} />

      <H>3. Redes sociais de terceiros</H>
      <P>
        O uso de Instagram, Facebook, YouTube e TikTok é regido pelos termos de cada rede. Ao conectar uma conta, você concorda também com os{" "}
        <A href="https://www.youtube.com/t/terms">Termos de Serviço do YouTube</A>, os{" "}
        <A href="https://www.tiktok.com/legal/page/global/terms-of-service/pt">Termos de Serviço do TikTok</A> e os{" "}
        <A href="https://developers.facebook.com/terms">Termos da Plataforma Meta</A>, conforme aplicável. O {APP_NAME} não é afiliado, patrocinado ou endossado por essas empresas.
      </P>
      <P>As redes podem limitar, suspender ou alterar suas APIs, cotas e regras a qualquer momento (por exemplo, limites diários de envio, vídeos privados até auditoria do aplicativo, ou bloqueio por excesso de postagens). Não garantimos que toda publicação será concluída e não nos responsabilizamos por decisões, falhas ou indisponibilidades dessas plataformas.</P>

      <H>4. Uso aceitável</H>
      <P>Você concorda em não usar a plataforma para:</P>
      <L items={[
        "publicar conteúdo ilegal, discriminatório, enganoso, que viole direitos autorais, de imagem ou de privacidade de terceiros;",
        "enviar spam, automatizar interações de forma abusiva ou violar as regras das redes sociais conectadas;",
        "tentar acessar áreas não autorizadas, burlar limites técnicos ou comprometer a segurança do serviço;",
        "usar o serviço para fins fraudulentos ou para prejudicar terceiros.",
      ]} />
      <P>Podemos suspender ou encerrar contas que violem estes termos, sem prejuízo de outras medidas cabíveis.</P>

      <H>5. Seu conteúdo</H>
      <P>Você mantém todos os direitos sobre o conteúdo que envia. Ao usar a plataforma, concede a ela licença limitada, não exclusiva, apenas para armazenar, processar e transmitir esse conteúdo às redes sociais conforme as suas instruções. Você é o único responsável pelo conteúdo publicado e por ter os direitos necessários sobre textos, imagens, vídeos e músicas.</P>

      <H>6. Privacidade</H>
      <P>O tratamento de dados pessoais é descrito na nossa <Link to="/privacidade" className="text-primary underline">Política de Privacidade</Link>, parte integrante destes termos.</P>

      <H>7. Disponibilidade e alterações</H>
      <P>Buscamos manter o serviço disponível, mas ele é oferecido "como está", podendo haver interrupções para manutenção ou por fatores fora do nosso controle. Podemos modificar, adicionar ou remover funcionalidades a qualquer momento.</P>

      <H>8. Limitação de responsabilidade</H>
      <P>Na máxima extensão permitida pela lei, o {APP_NAME} não responde por danos indiretos, lucros cessantes, perda de audiência ou de contas em redes sociais decorrentes do uso da plataforma ou de ações das redes conectadas. Nada nestes termos exclui direitos garantidos pela legislação de defesa do consumidor.</P>

      <H>9. Encerramento</H>
      <P>Você pode parar de usar o serviço e solicitar a exclusão da conta quando quiser (veja a Política de Privacidade). Ao encerrar, os acessos às redes sociais conectadas são removidos.</P>

      <H>10. Alterações nos termos</H>
      <P>Podemos atualizar estes termos. O uso continuado após a atualização significa que você concorda com a nova versão. Mudanças relevantes serão comunicadas na plataforma.</P>

      <H>11. Lei aplicável e foro</H>
      <P>Estes termos são regidos pelas leis brasileiras. Fica eleito o foro do domicílio do usuário para dirimir controvérsias, quando a lei assim determinar.</P>

      <H>12. Contato</H>
      <P><a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></P>
    </Shell>
  );
}
