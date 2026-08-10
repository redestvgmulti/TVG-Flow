# CSS & Design System Audit | TVG Flow
**Data de Geração:** 06/01/2026
**Autor:** Antigravity (Design System Lead)
**Versão:** 1.0

---

## 🎨 1. Arquitetura de Estilos

### Stack Identificada
*   **Engine:** CSS Puro (Vanilla) + CSS Variables (Tokens).
*   **Metodologia:** Híbrida (Modular CSS + Utilitários).
*   **Framework:** **Nenhum**. Não há Tailwind, Bootstrap ou Styled Components. É um sistema "Artesanal".

### Estrutura de Arquivos (`src/styles`)
A pasta está bem organizada, mas revela a falta de um padrão rígido:
1.  `tokens.css`: A "Single Source of Truth". Define `--color-primary`, `--space-4`, etc. Excelente.
2.  `utilities.css`: Tenta simular o Tailwind com classes como `.flex`, `.items-center`.
3.  `components.css`: Estilos genéricos de botões, cards e inputs.
4.  **Arquivos Específicos:** Existem `adminTasks.css`, `companies.css`, etc. Isso indica que não conseguiram abstrair tudo para componentes genéricos.

---

## ⚠️ 2. Inconsistências & Débitos Técnicos

### 2.1. A "Praga" do Inline Style
Apesar de ter um Design System, o time de desenvolvimento (ou a devida pressa) usou `style={{...}}` massivamente.
*   **Onde:** Identificado em **23 arquivos principais**.
    *   `src/pages/admin/Tasks.jsx`
    *   `src/pages/admin/CompanyDetails.jsx`
    *   `src/components/forms/TaskForm.jsx`
*   **O Problema:** Estilos inline têm **especificidade infinita** (difícil de sobrescrever com CSS) e quebram a responsividade (Media Queries não funcionam em inline styles).
*   **Exemplo Real:**
    ```jsx
    // Encontrado em ProfessionalsList
    style={{ padding: '1.5rem', paddingLeft: '2rem' }}
    ```
    Isso deveria ser uma classe utility ou definida no CSS do componente.

### 2.2. "Fake Tailwind" (Utilities.css)
O arquivo `utilities.css` recria classes do Tailwind manualmente.
*   **Risco:** Manter isso é custoso. O desenvolvedor precisa "adivinhar" quais classes existem (`.mt-4` existe? ou seria `.margin-top-small`?).
*   **Recomendação:** Ou adota Tailwind de verdade (para ter IntelliSense e padronização) ou remove isso em favor de CSS Modules puros.

### 2.3. Mobile-First? Não.
A análise dos arquivos CSS mostra muitas `@media (max-width: 768px)`, o que indica uma abordagem **Desktop-First** que é "consertada" para mobile.
*   Isso explica certas fragilidades visuais em telas pequenas relatadas no documento de QA.

---

## 💎 3. O Design System "CityOS"

### Pontos Fortes
*   **Tokens Sólidos:** As variáveis CSS em `tokens.css` são semânticas (`--color-bg-surface`, `--color-text-primary`) e não apenas valores (`#FFF`, `#000`). Isso facilita muito a implementação de **Dark Mode** no futuro.
*   **Identidade Visual:** O uso consistente de Glassmorphism (`backdrop-filter`) e sombras suaves (`--shadow-float`) dá uma identidade premium única ao projeto, fugindo do "Bootstrap padrão".

### O que precisa virar Componente
Elementos repetidos que estão "hardcoded" (copiados e colados) em várias páginas:
1.  **Page Header:** O cabeçalho com Título, Subtítulo e Botão de Ação.
2.  **Status Badge:** As pílulas coloridas de status (Pendente, Atrasado).
3.  **Empty State:** O desenho que aparece quando não há dados.

---

## 📝 4. Veredito e Ação

O CSS do TVG Flow é **bonito na superfície, mas caótico no código**.

**Plano de Higienização:**
1.  **Banir Inline Styles:** Converter progressivamente os `style={{}}` para classes no arquivo CSS correspondente.
2.  **Documentar Utilitários:** Se formos manter o `utilities.css`, criar um guia rápido do que existe lá.
3.  **Extrair Componentes de UI:** Criar `<Badge>`, `<PageHeader>` e `<EmptyState>` para eliminar CSS duplicado.

---

*Documento gerado para equipe de Frontend e Design Ops.*
