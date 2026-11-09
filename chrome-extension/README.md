# CollabSuite — extensão do Chrome (Tarefas do dia)

Mostra as tarefas de hoje e permite criar novas sem abrir o sistema.

## Instalar
1. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione esta pasta (`chrome-extension/`).
3. Fixe a extensão na barra do Chrome (ícone de quebra-cabeça).

## Usar
- Na primeira vez, informe o **endereço do sistema** (ex.: `https://app.suaempresa.com` ou `http://localhost:3000`), seu e-mail/usuário e a senha.
- **Hoje:** lista as tarefas com data de hoje em que você é responsável ou participante, ordenadas por horário. Marque a caixa para concluir/reabrir; clique no título para abrir a tarefa no sistema.
- **Adicionar:** digite o título e escolha o **projeto** (o funil, quando o projeto tem mais de um, e a etapa), o **responsável** (você ou qualquer membro do projeto, ou ninguém), horário, prioridade e tipo. A tarefa é criada para hoje, na **etapa** escolhida (a primeira do funil por padrão). Sem projeto, ela é uma tarefa pessoal sua. O último projeto usado fica selecionado.
- O ícone mostra o número de tarefas de hoje ainda pendentes (atualiza a cada 15 min e ao usar o popup).

## Detalhes
- Usa a mesma API do sistema (`/api/auth/login`, `/api/tasks`) com o token JWT guardado em `chrome.storage.local`. A senha não é armazenada.
- Se o token expirar, o popup volta para a tela de login.
- Se o servidor define `CORS_ORIGIN`, a extensão pede permissão ao endereço informado no login para conseguir acessá-lo.
