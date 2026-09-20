import { createApp } from './server.js';

const app = createApp();
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✨ Luggy API Server (In-Memory) running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🏠 Ready for Provider & Renter flows!`);
});
