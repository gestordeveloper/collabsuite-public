# Documentação da API Pública - CollabSuite

Esta documentação detalha os endpoints da API pública do CollabSuite para permitir integrações eficientes com outras plataformas (como CRMs, sistemas de ERP, automações webhook, etc.).

---

## 🚀 Visão Geral e URL Base

A URL base para todas as chamadas da API é:
`http://localhost:3000/api` (ambiente de desenvolvimento)

Todos os dados trafegados na API utilizam o formato **JSON**.

---

## 🔒 Autenticação

A maioria dos endpoints requer autenticação por meio de um token JWT (JSON Web Token).
O token deve ser enviado no cabeçalho HTTP de cada requisição sob a chave `Authorization` usando o padrão `Bearer`:

```http
Authorization: Bearer <SEU_TOKEN_JWT>
```

Para obter o token, você deve realizar o **Login** ou **Registro** utilizando os endpoints descritos na seção abaixo.

---

## 📂 1. Autenticação e Usuários

### Criar Usuário (Registro)
Cria um novo usuário na plataforma. Retorna o token JWT e as informações do usuário criado.

* **URL**: `/auth/register`
* **Método**: `POST`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "first_name": "João",
    "last_name": "Silva",
    "email": "joao.silva@exemplo.com",
    "username": "joaosilva",
    "password": "senhaSegura123",
    "biography": "Desenvolvedor de Software",
    "photo": "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"
  }
  ```
* **Exemplo de Resposta (201 Created)**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user": {
      "id": 1,
      "first_name": "João",
      "last_name": "Silva",
      "email": "joao.silva@exemplo.com",
      "username": "joaosilva",
      "biography": "Desenvolvedor de Software",
      "photo": "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150",
      "role": "user",
      "level": 1
    }
  }
  ```

### Autenticar Usuário (Login)
Obtém o token JWT a partir do e-mail/username e senha do usuário.

* **URL**: `/auth/login`
* **Método**: `POST`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "login": "joaosilva", 
    "password": "senhaSegura123"
  }
  ```
  *(Nota: O campo `login` pode ser tanto o e-mail quanto o username)*
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user": {
      "id": 1,
      "first_name": "João",
      "last_name": "Silva",
      "email": "joao.silva@exemplo.com",
      "username": "joaosilva",
      "role": "user",
      "level": 1
    }
  }
  ```

### Listar Usuários
Lista todos os usuários registrados no sistema. Requer autenticação.

* **URL**: `/users`
* **Método**: `GET`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  [
    {
      "id": 1,
      "first_name": "João",
      "last_name": "Silva",
      "username": "joaosilva",
      "photo": "https://..."
    }
  ]
  ```

---

## 📁 2. Projetos (Funnels)

Os projetos no CollabSuite são estruturados em "Funnels" (Funis), que possuem etapas (Stages) e tarefas.

### Criar Projeto
Cria um novo projeto. O criador será associado automaticamente como membro do projeto. A criação do projeto inicializa automaticamente 6 etapas padrão no Kanban: `BACKLOG`, `SPRINT GOAL`, `TODO`, `IN PROGRESS`, `REVIEW / QA` e `DONE`.

* **URL**: `/funnels`
* **Método**: `POST`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "name": "Meu Projeto Novo",
    "content": "Descrição ou notas do projeto",
    "color": "#4f46e5"
  }
  ```
* **Exemplo de Resposta (201 Created)**:
  ```json
  {
    "id": 5,
    "name": "Meu Projeto Novo",
    "content": "Descrição ou notas do projeto",
    "color": "#4f46e5",
    "user_id": 1,
    "funnel_default": 0,
    "created_at": "2026-07-09T12:00:00.000Z",
    "updated_at": "2026-07-09T12:00:00.000Z"
  }
  ```

### Listar Projetos
Retorna todos os projetos em que o usuário autenticado é o criador ou participante. Retorna também as etapas de cada projeto e usuários associados.

* **URL**: `/funnels`
* **Método**: `GET`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  [
    {
      "id": 5,
      "name": "Meu Projeto Novo",
      "content": "Descrição ou notas do projeto",
      "color": "#4f46e5",
      "stages": [
        { "id": 12, "name": "BACKLOG", "status": "notdone", "stage_order": 0 },
        { "id": 13, "name": "SPRINT GOAL", "status": "notdone", "stage_order": 1 },
        { "id": 14, "name": "TODO", "status": "notdone", "stage_order": 2 },
        { "id": 15, "name": "IN PROGRESS", "status": "inprogress", "stage_order": 3 },
        { "id": 16, "name": "REVIEW / QA", "status": "inprogress", "stage_order": 4 },
        { "id": 17, "name": "DONE", "status": "done", "stage_order": 5 }
      ]
    }
  ]
  ```

### Atualizar Projeto
Atualiza o nome, conteúdo, cor ou configurações de um projeto.

* **URL**: `/funnels/:id`
* **Método**: `PUT`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "name": "Projeto Atualizado",
    "color": "#ec1889",
    "favorite": true
  }
  ```
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "id": 5,
    "name": "Projeto Atualizado",
    "color": "#ec1889",
    "favorite": true,
    "updated_at": "2026-07-09T12:05:00.000Z"
  }
  ```

### Excluir Projeto
Exclui permanentemente um projeto e todos os seus recursos vinculados (etapas, tarefas, etc.).

* **URL**: `/funnels/:id`
* **Método**: `DELETE`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "success": true
  }
  ```

---

## 📝 3. Tarefas (Tasks)

### Criar Tarefa
Cria uma nova tarefa vinculada a um projeto (funnel) e a uma etapa (stage).

* **URL**: `/tasks`
* **Método**: `POST`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "funnel_id": 5,
    "stage_id": 14,
    "title": "Configurar Servidor de Produção",
    "description": "Configuração do Nginx, firewall e SSL",
    "priority": "high",
    "user_id": 1,
    "due_at": "2026-07-15",
    "hour_at": "14:30",
    "estimated_time": "04:00",
    "story_points": 5,
    "type": "task",
    "is_sprint": false,
    "is_called": 1,
    "is_whatsapp": "0",
    "sprint_id": null,
    "call_reason": "Motivo da chamada",
    "platform_company_id": 12345,
    "platform_company_name": "Nome da Empresa CRM",
    "first_name": "João",
    "last_name": "Silva"
  }
  ```
  * **Opções e coerções**:
    * `priority`: `low`, `medium`, `high`, `none`
    * `type`: `task`, `meeting`
    * **Coerção de Boas Práticas (Zod Coercible Booleans)**: Os campos `is_sprint`, `is_called` e `is_whatsapp` aceitam tanto booleanos nativos do JSON (`true`/`false`), inteiros (`1`/`0`) quanto strings representativas (`"1"`/`"0"`, `"true"`/`"false"`).
    * **Integração de Plataformas Externas / CRM**: Os campos `platform_company_id`, `platform_company_name`, `first_name` e `last_name` podem ser passados diretamente para sincronização.
* **Exemplo de Resposta (201 Created)**:
  ```json
  {
    "id": 42,
    "title": "Configurar Servidor de Produção",
    "description": "Configuração do Nginx, firewall e SSL",
    "priority": "high",
    "status": "notdone",
    "funnel_id": 5,
    "stage_id": 14,
    "user_id": 1,
    "due_at": "2026-07-15T00:00:00.000Z",
    "hour_at": "14:30",
    "estimated_time": "04:00",
    "story_points": 5,
    "type": "task",
    "created_at": "2026-07-09T12:10:00.000Z"
  }
  ```

### Listar e Filtrar Tarefas
Retorna uma lista paginada de tarefas com base em filtros opcionais.

* **URL**: `/tasks`
* **Método**: `GET`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Parâmetros Query**:
  * `page` (padrão `1`)
  * `limit` (padrão `50`)
  * `funnel_id` (filtro por projeto)
  * `user_id` (filtro por responsável ou participante)
  * `status` (`notdone`, `inprogress`, `done`)
  * `is_sprint` (`true`, `false`)
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "data": [
      {
        "id": 42,
        "title": "Configurar Servidor de Produção",
        "status": "notdone",
        "priority": "high",
        "user": {
          "id": 1,
          "first_name": "João"
        },
        "checklists": [],
        "attachments": [],
        "activities": []
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
  ```

### Detalhes da Tarefa
Busca as informações completas de uma tarefa específica, incluindo checklists, anexos, membros associados e histórico de atividades/comentários.

* **URL**: `/tasks/:id`
* **Método**: `GET`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "id": 42,
    "title": "Configurar Servidor de Produção",
    "description": "...",
    "checklists": [
      { "id": 2, "title": "Instalar Docker", "is_done": true }
    ],
    "attachments": [
      { "id": 1, "file_name": "manual_config.pdf", "file_url": "/uploads/manual.pdf" }
    ],
    "activities": [
      { "id": 5, "content": "Instalação concluída com sucesso.", "created_at": "...", "user": { "first_name": "João" } }
    ]
  }
  ```

### Atualizar Tarefa
Atualiza propriedades específicas de uma tarefa (ex: mover de etapa, alterar prioridade, mudar status).

* **URL**: `/tasks/:id`
* **Método**: `PUT`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "stage_id": 15,
    "status": "inprogress",
    "priority": "medium",
    "is_called": true,
    "platform_company_name": "Empresa CRM Atualizada"
  }
  ```
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "id": 42,
    "stage_id": 15,
    "status": "inprogress",
    "priority": "medium",
    "updated_at": "2026-07-09T12:15:00.000Z"
  }
  ```

### Excluir Tarefa (Soft Delete)
Exclui logicamente a tarefa do sistema (define a data `deleted_at`).

* **URL**: `/tasks/:id`
* **Método**: `DELETE`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "success": true
  }
  ```

### Adicionar Membro à Tarefa
Associa um usuário participante adicional à tarefa.

* **URL**: `/tasks/:id/members`
* **Método**: `POST`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "user_id": 2
  }
  ```
* **Exemplo de Resposta (201 Created)**:
  ```json
  {
    "id": 8,
    "task_id": 42,
    "user_id": 2,
    "created_at": "2026-07-09T12:20:00.000Z"
  }
  ```

### Remover Membro da Tarefa
Remove a associação de um participante da tarefa.

* **URL**: `/tasks/:id/members/:userId`
* **Método**: `DELETE`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "success": true
  }
  ```

---

## 📎 4. Upload e Anexo de Arquivos

O fluxo para upload de arquivos em tarefas ocorre em duas etapas obrigatórias:
1. **Fazer upload físico do arquivo** via string Base64 para obter a URL interna.
2. **Associar essa URL à tarefa** criando um registro de anexo.

### Passo 1: Upload Físico do Arquivo (Base64)
Envia o arquivo no formato de String codificada em Base64 contendo os metadados corretos.

* **URL**: `/upload`
* **Método**: `POST`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "image": "data:application/pdf;base64,JVBERi0xLjQKJ..."
  }
  ```
  *(Nota: O campo se chama `image`, mas suporta PDFs, Docs, Planilhas e Imagens, deduzindo a extensão a partir do cabeçalho base64 `data:<mime-type>;base64,`)*
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "url": "/uploads/1720527600000-abc123xyz.pdf"
  }
  ```

### Passo 2: Vincular Arquivo à Tarefa
Associa a URL gerada no Passo 1 como um anexo definitivo de uma tarefa.

* **URL**: `/tasks/:taskId/attachments`
* **Método**: `POST`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "file_name": "manual_configuracao.pdf",
    "file_url": "/uploads/1720527600000-abc123xyz.pdf",
    "file_size": 102450,
    "file_type": "application/pdf"
  }
  ```
* **Exemplo de Resposta (201 Created)**:
  ```json
  {
    "id": 9,
    "task_id": 42,
    "file_name": "manual_configuracao.pdf",
    "file_url": "/uploads/1720527600000-abc123xyz.pdf",
    "file_size": 102450,
    "file_type": "application/pdf",
    "created_at": "2026-07-09T12:25:00.000Z"
  }
  ```

### Listar Anexos da Tarefa
Retorna todos os anexos vinculados a uma tarefa específica.

* **URL**: `/tasks/:taskId/attachments`
* **Método**: `GET`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  [
    {
      "id": 9,
      "task_id": 42,
      "file_name": "manual_configuracao.pdf",
      "file_url": "/uploads/1720527600000-abc123xyz.pdf",
      "file_size": 102450,
      "file_type": "application/pdf"
    }
  ]
  ```

### Remover Anexo
Remove permanentemente o vínculo do anexo da tarefa.

* **URL**: `/tasks/:taskId/attachments/:attachmentId`
* **Método**: `DELETE`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "success": true
  }
  ```

---

## 💬 5. Comentários na Tarefa (Activities)

Adiciona um comentário ou log de atividade a uma tarefa específica.

### Criar Comentário
* **URL**: `/tasks/:id/activities`
* **Método**: `POST`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "content": "Servidor provisionado com sucesso. Iniciando configuração do firewall."
  }
  ```
* **Exemplo de Resposta (201 Created)**:
  ```json
  {
    "id": 14,
    "task_id": 42,
    "user_id": 1,
    "content": "Servidor provisionado com sucesso. Iniciando configuração do firewall.",
    "created_at": "2026-07-09T12:30:00.000Z",
    "updated_at": "2026-07-09T12:30:00.000Z"
  }
  ```

---

## ☑️ 6. Checklist

Cada tarefa pode conter múltiplos itens de checklist que podem ser ativados, editados ou marcados como concluídos.

### Listar Itens do Checklist
Retorna todos os itens de checklist vinculados a uma tarefa específica.

* **URL**: `/tasks/:id/checklist`
* **Método**: `GET`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  [
    {
      "id": 12,
      "task_id": 42,
      "title": "Criar banco de dados MySQL",
      "is_done": false
    },
    {
      "id": 13,
      "task_id": 42,
      "title": "Configurar certificados SSL",
      "is_done": true
    }
  ]
  ```

### Criar Item no Checklist
Cria um novo item desmarcado (`is_done: false`) no checklist de uma tarefa.

* **URL**: `/tasks/:id/checklist`
* **Método**: `POST`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "title": "Configurar regras do Firewall UFW"
  }
  ```
* **Exemplo de Resposta (201 Created)**:
  ```json
  {
    "id": 14,
    "task_id": 42,
    "title": "Configurar regras do Firewall UFW",
    "is_done": false,
    "created_at": "2026-07-09T12:35:00.000Z"
  }
  ```

### Atualizar Item do Checklist
Edita o título ou altera o estado de conclusão (`is_done`) de um item do checklist usando o ID do item.

* **URL**: `/tasks/checklist/:id`
* **Método**: `PUT`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Corpo da Requisição (JSON)**:
  ```json
  {
    "title": "Configurar regras do Firewall UFW (OK)",
    "is_done": true
  }
  ```
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "id": 14,
    "task_id": 42,
    "title": "Configurar regras do Firewall UFW (OK)",
    "is_done": true,
    "updated_at": "2026-07-09T12:36:00.000Z"
  }
  ```

### Excluir Item do Checklist
Exclui permanentemente o item do checklist.

* **URL**: `/tasks/checklist/:id`
* **Método**: `DELETE`
* **Cabeçalhos**: `Authorization: Bearer <TOKEN>`
* **Exemplo de Resposta (200 OK)**:
  ```json
  {
    "success": true
  }
  ```

---

## 🎨 Swagger UI

Para testar as requisições de forma interativa, visualizar os tipos exatos de parâmetros e gerar códigos automáticos em várias linguagens, você pode acessar a documentação Swagger online em sua própria máquina:

👉 **URL de Acesso**: [http://localhost:3000/docs/index.html](http://localhost:3000/docs/index.html)

No Swagger UI, utilize o botão **Authorize** no canto superior direito e insira o token obtido no Login no formato: `Bearer <SEU_TOKEN>` para realizar requisições autenticadas diretamente pelo navegador.
