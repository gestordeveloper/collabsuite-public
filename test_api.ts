import 'dotenv/config';
import axios from 'axios';
import jwt from 'jsonwebtoken';

async function test() {
  const token = jwt.sign({ userId: 1 }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '1d' });
  try {
    const res = await axios.get('http://localhost:3000/api/funnels', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("STATUS:", res.status);
    console.log("DATA:", JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error("ERROR:", err.response ? err.response.data : err.message);
  }
}
test();
