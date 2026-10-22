# Nota Fácil

# CRIAR NOVA FERRAMENTA INDIVIDUAL: NOTA

Crie uma ferramenta independente chamada **NOTA** dentro do D4S.

Objetivo: utilizar IA + OCR para extrair informações de notas fiscais, comprovantes e documentos enviados pelo usuário.

## Controle de Plano

A ferramenta deve ser exclusiva para usuários do Plano Empresarial.

Se o usuário não possuir o Plano Empresarial:

* Exibir tela de bloqueio.
* Mostrar benefícios da ferramenta.
* Exibir botão "Fazer Upgrade".

---

## Upload

Permitir envio de até 10 imagens simultaneamente.

Formatos:

* JPG
* JPEG
* PNG
* WEBP
* PDF

Exibir progresso de processamento.

---

## Extração Inteligente

A IA deve identificar automaticamente:

* Nome
* CPF
* CNPJ
* E-mail
* Telefone
* CEP
* Endereço
* Número
* Bairro
* Cidade
* Estado
* Número da Nota Fiscal
* Data da Nota
* Valor Total

Ignorar campos não encontrados.

---

## Resultado

Exibir os dados organizados em cartões.

Cada campo deve possuir botão individual:

[Copiar]

Exemplo:

Nome
João Silva
[Copiar]

CPF
123.456.789-00
[Copiar]

E-mail
[joao@email.com](mailto:joao@email.com)
[Copiar]

Telefone
(21) 99999-9999
[Copiar]

Também adicionar:

* Copiar Tudo

---

## Exportação

Após processar os documentos exibir:

Exportar para:

* Word (.docx)
* Excel (.xlsx)
* PDF (.pdf)

---

## Regra de Arquivos

Antes de exportar perguntar:

Deseja:

( ) Adicionar ao arquivo existente

( ) Criar novo arquivo

Nunca substituir arquivos existentes.

Sempre criar versões novas.

Exemplos:

clientes_001.docx

clientes_002.docx

clientes_001.xlsx

clientes_002.xlsx

clientes_001.pdf

clientes_002.pdf

---

## Exportação de E-mails

Criar botão:

"Exportar Apenas E-mails"

Extrair todos os e-mails encontrados.

Remover duplicados.

Permitir exportação:

* Word
* Excel
* PDF

---

## Estrutura Excel

Colunas:

Nome | CPF | E-mail | Telefone | CEP | Endereço | Número | Cidade | Estado | Nota Fiscal | Data | Valor

---

## Estrutura PDF

Gerar relatório profissional contendo:

* Logo D4S
* Data de geração
* Quantidade de registros
* Tabela organizada

---

## Estrutura Word

Organizar informações em blocos de cadastro para leitura rápida.

---

## Histórico

Criar aba:

"Arquivos Gerados"

Exibir:

* Nome do arquivo
* Data
* Quantidade de registros
* Download

---

## Interface

Visual moderno seguindo o padrão visual atual do D4S.

Compatível com:

* Desktop
* Mobile

---

## Importante

Utilizar OCR e IA apenas durante o processamento das imagens.

Não criar novas páginas ou módulos fora da ferramenta NOTA.

A implementação deve aproveitar a estrutura existente do D4S para minimizar consumo de créditos e alterações desnecessárias no projeto.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://clever-nota-scan.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7491fa2d-ed24-4217-8582-c6e3978af0e7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
