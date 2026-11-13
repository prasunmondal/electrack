import { health } from "../backend/src/api.js";

export default function handler(req, res) {
  const { status, body } = health();
  res.status(status).json(body);
}
