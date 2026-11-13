import { isAuthorized, unauthorized, listConsumers } from "../backend/src/api.js";

export default function handler(req, res) {
  const { status, body } = isAuthorized(req.headers["x-api-key"]) ? listConsumers() : unauthorized;
  res.status(status).json(body);
}
