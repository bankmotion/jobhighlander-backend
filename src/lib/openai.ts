import OpenAI from 'openai';
import { env } from '../config/env';
import { PROVIDER_MODEL } from './ai';

let client: OpenAI | undefined;

export function openai(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set — add it to backend/.env');
  }
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}

export const OPENAI_MODEL = PROVIDER_MODEL.openai;
