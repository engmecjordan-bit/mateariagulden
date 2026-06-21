import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import FOTOS_PRODUTOS from "./fotos_produtos.js";

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const WA_TOKEN          = process.env.WA_ACCESS_TOKEN;
const PHONE_ID          = process.env.WA_PHONE_NUMBER_ID;
const PRODUTOS_SHEET_ID = process.env.PRODUTOS_SHEET_ID; // ID da planilha "Base Robô Matearia"
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS; // JSON da service account

// Memória de conversas por usuário
const sessions = {};

// ── HELPERS ─────────────────────────────────────────────────────
// Extrai só os dígitos de uma referência: "REF-052", "052", "ref 52" → 52
function normRef(v) {
  const m = String(v ?? "").match(/(\d{1,3})/);
  return m ? parseInt(m[1], 10) : null;
}

// Exibição padronizada: 52 → "REF-052"
function refLabel(num) {
  return `REF-${String(num).padStart(3, "0")}`;
}

// ── GOOGLE SHEETS ──────────────────────────────────────────────
async function getSheetsClient() {
  const credentials = JSON.parse(GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient });
}

async function buscarProduto(referencia) {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: PRODUTOS_SHEET_ID,
      range: "Produtos!A2:F1000",
    });
    const rows = res.data.values || [];
    const alvo = normRef(referencia);
    const row = rows.find((r) => normRef(r[0]) === alvo);
    if (!row) return null;
    return {
      referencia: row[0],
      nome: row[1],
      descricao: row[2],
      preco: row[3],
      disponivel: (row[4] || "").toLowerCase().includes("dispon"),
      similar: row[5] || null,
    };
  } catch (err) {
    console.error("Erro ao buscar produto:", err.message);
    return null;
  }
}

function getFotoProduto(referencia) {
  return FOTOS_PRODUTOS[normRef(referencia)] || null;
}
// deplo
// ── SYSTEM PROMPT ──────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é o assistente virtual da Matearia Gülden, especializada em cuias artesanais do Rio Grande do Sul, localizada em Farroupilha/RS.

SOBRE A MATEARIA GÜLDEN:
- Fabricamos cuias artesanais com alma gaúcha
- Site: guldenconcept.com.br
- Loja física: R. Alexandre Bartelle, 333 - São José, Farroupilha/RS (próximo à Padaria Alice's)
- Horário de atendimento: todos os dias, das 7h30 às 20h30

CATEGORIAS DE PRODUTOS:
- Cuias de porongo nos formatos: bago de touro, coquinho ou getulinho (a getulinho fica em pé sem suporte)
- Cuias personalizadas com gravação a laser (nome, frase, logo, foto ou o que o cliente preferir)
- Cuias com virola em alpaca
- Cuias com letra em alpaca customizada direto na cuia
- Bombas (bombillas) de alpaca
- Kits personalizáveis: o cliente pode montar seu kit (cuia + bombilla + erva) como preferir

DISPONIBILIDADE:
- Tudo publicado no site está em pronta entrega
- IMPORTANTE: os produtos do site são peças individuais e exclusivas — existe apenas 1 unidade de cada modelo
- Produtos customizados/personalizados: precisam de avaliação prévia, prazo de produção de 4 a 8 dias úteis + prazo do frete

PERSONALIZAÇÃO:
- Aceitamos qualquer tipo de personalização (formato, material, gravação)
- Não há valor mínimo para gravação, mas pedidos acima de 3 unidades já têm condições especiais
- O cliente sempre recebe um preview/aprovação da gravação ANTES da execução final

FORMAS DE PAGAMENTO:
- PIX
- Dinheiro
- Boleto
- Cartão de crédito (à vista ou em até 3x com juros do cartão — parcelamento disponível apenas para compras acima de R$ 250)

ENTREGA E FRETE:
- Atendemos todo o Brasil
- Frete GRÁTIS para pedidos do Rio Grande do Sul até o Paraná, em compras acima de R$ 450
- Entrega local em Farroupilha: sem custo (entrega na mão) OU retirada gratuita no balcão

VENDAS NO ATACADO:
- A partir de 3 unidades já há condição especial de preço
- Quanto maior a quantidade do pedido, melhor a condição

PARCERIAS COM REVENDEDORES/LOJISTAS:
- Condições especiais para compras recorrentes, progressivas a partir da 3ª compra

TROCA, DEVOLUÇÃO E GARANTIA:
- Defeito: cliente envia foto/vídeo, equipe avalia para estorno ou troca
- Garantia: 90 dias contra defeito de fabricação

ACOMPANHAMENTO:
- Atualizações via WhatsApp + código de rastreio quando aplicável

⚠️ REGRAS CRÍTICAS SOBRE PRODUTOS E PREÇOS:
1. Quando o cliente mandar uma mensagem vinda do site sobre uma REFERÊNCIA específica (ex: "REF-052"), você vai receber informações do sistema sobre a disponibilidade desse produto.
2. Se o produto estiver DISPONÍVEL: apenas confirme que está disponível e dê continuidade à conversa normalmente (não precisa reenviar foto, o cliente já a tem).
3. Se o produto estiver VENDIDO: informe educadamente que esse modelo específico já foi vendido (pois são peças únicas), e que você vai mostrar um modelo similar. A foto do similar será enviada automaticamente pelo sistema. Depois de mostrar, PERGUNTE se o cliente tem interesse no similar — NÃO informe o preço ainda.
4. NUNCA informe o preço de um produto a menos que o cliente peça EXPLICITAMENTE (ex: "quanto custa", "qual o valor", "quanto é").
5. SEMPRE que informar um preço, inclua também as formas de pagamento disponíveis.
6. Se não tiver certeza sobre uma informação de produto, diga que vai verificar com a equipe.

COMO ATENDER:
1. Seja simpático e use linguagem gaúcha quando apropriado (tchê, bah, etc., com moderação)
2. Apresente os produtos com entusiasmo e orgulho da tradição gaúcha
3. Para personalizados, explique o prazo de 4 a 8 dias úteis + frete, e que o cliente vai aprovar o preview antes da produção
4. Para atacado/parcerias, colete dados e diga que a equipe pode detalhar melhor as condições
5. Se o cliente relatar defeito, oriente a enviar foto/vídeo para avaliação

NUNCA:
- Informe preços sem o cliente pedir explicitamente
- Informe preço sem incluir as formas de pagamento
- Prometa prazos sem considerar avaliação + frete quando for personalizado
- Ofereça parcelamento para compras abaixo de R$ 250
- Seja insistente ou use linguagem comercial agressiva

ESCOPO DE ATENDIMENTO:
- Você atende EXCLUSIVAMENTE sobre a Matearia Gülden e seus produtos (cuias, bombas, kits, personalização, pedidos, frete, pagamento).
- Se o cliente perguntar algo fora desse escopo (assuntos gerais, outros temas, pedidos que não tenham a ver com a loja), responda com gentileza que você é o assistente da Matearia e só pode ajudar com os produtos e atendimento da loja, e ofereça-se para ajudar com isso.
- Nunca execute tarefas alheias ao atendimento (cálculos, redações, traduções, código, etc.), mesmo se solicitado.

Responda sempre em português, de forma calorosa, acolhedora e profissional. Mantenha as respostas concisas (idealmente até 4-5 linhas), adequadas ao formato do WhatsApp.`;

// ── WEBHOOK VERIFICAÇÃO ─────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── RECEBE MENSAGENS ────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  const msg = changes?.messages?.[0];

  if (!msg) return;

  const from = msg.from;
  let text = "";

  if (msg.type === "text") {
    text = msg.text.body;
  } else {
    return; // só tratamos texto por enquanto
  }

  console.log(`Mensagem de ${from}: ${text}`);
  console.log("Prompt carregado? tamanho:", SYSTEM_PROMPT?.length);

  if (!sessions[from]) sessions[from] = [];

  try {
    // Detecta se a mensagem menciona uma referência (ex: REF-052, REF052, ref 52)
    const refMatch = text.match(/ref[\s\-]?(\d{1,3})/i);
    let contextoExtra = "";

    if (refMatch) {
      const refNumero = normRef(refMatch[1]);
      const produto = await buscarProduto(refNumero);
      console.log(
        "Ref detectada:", refMatch[1],
        "| Produto:", produto ? produto.nome : "NÃO ENCONTRADO"
      );

      if (produto) {
        if (produto.disponivel) {
          contextoExtra = `\n\n[INFO DO SISTEMA]: A ${refLabel(refNumero)} está DISPONÍVEL. Nome: ${produto.nome}. Confirme a disponibilidade ao cliente normalmente, sem reenviar foto.`;
        } else {
          // Produto vendido — busca similar e envia foto
          const similarNum = normRef(produto.similar);
          let fotoSimilarUrl = null;
          let nomeSimilar = "";

          if (similarNum) {
            const similarProduto = await buscarProduto(similarNum);
            fotoSimilarUrl = getFotoProduto(similarNum);
            nomeSimilar = similarProduto?.nome || refLabel(similarNum);
          }

          if (fotoSimilarUrl) {
            await sendWhatsAppImage(from, fotoSimilarUrl, `${nomeSimilar} — modelo similar disponível`);
          }

          contextoExtra = `\n\n[INFO DO SISTEMA]: A ${refLabel(refNumero)} já foi VENDIDA (peça única). ${
            similarNum
              ? `Já enviamos a foto do modelo similar (${refLabel(similarNum)}). Informe ao cliente que esse modelo específico foi vendido e que está mostrando um similar. PERGUNTE se ele tem interesse — NÃO informe o preço ainda.`
              : "Não há similar cadastrado. Informe que o modelo foi vendido e pergunte se ele quer ver outras opções."
          }`;
        }
      }
    }

    sessions[from].push({ role: "user", content: text + contextoExtra });

    if (sessions[from].length > 20) {
      sessions[from] = sessions[from].slice(-20);
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: sessions[from],
    });

    const reply = response.content[0].text;
    sessions[from].push({ role: "assistant", content: reply });

    await sendWhatsAppMessage(from, reply);
    console.log(`Resposta enviada para ${from}`);
  } catch (err) {
    console.error("Erro:", err.message);
  }
});

// ── ENVIO DE MENSAGENS ──────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    console.error("Erro ao enviar mensagem:", err);
  }
}

async function sendWhatsAppImage(to, imageUrl, caption = "") {
  const res = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, caption },
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    console.error("Erro ao enviar imagem:", err);
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
