/* ============================================================================
   index.js
   ----------------------------------------------------------------------------
   Ponto de entrada da API. Uso:
     npm install
     npm run setup   (cria as tabelas e os dados iniciais)
     npm start        (ou npm run dev, que reinicia sozinho a cada alteração)
   ============================================================================ */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

if (!process.env.JWT_SECRET) {
  console.error('❌ Variável JWT_SECRET não encontrada. Configure o arquivo .env (veja .env.example).');
  process.exit(1);
}

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Permite chamadas sem "Origin" (ex: Postman/curl) e as origens configuradas.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('Origem não permitida por CORS: ' + origin));
    }
  })
);
app.use(express.json({ limit: '15mb' })); // limite maior por causa das fotos em base64

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/site-content', require('./routes/siteContent'));
app.use('/api/reviews', require('./routes/reviews'));

app.use((req, res) => res.status(404).json({ message: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Erro interno do servidor.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ API da Brincar de Desejo rodando na porta ${port}`);
});
