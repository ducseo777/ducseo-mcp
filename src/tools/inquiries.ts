import { z } from 'zod';
import { seg } from '../client';
import { READ, defineTool, pageArgs, paging } from './define';

const PRIVACY = "Inquiries contain buyers' personal data: use them only for what the user asked, and do not copy them into other services.";

export const listInquiries = defineTool({
  name: 'list_inquiries',
  title: 'List inquiries',
  description: `Inquiries from the website, newest first: buyer, company, country, products, status, and the start of the message. Filter by status or search text. Paginated. ${PRIVACY}`,
  requires: ['inquiries.read'],
  capability: 'inquiries',
  input: {
    status: z.enum(['new', 'contacted', 'quoted', 'won', 'invalid']).optional(),
    q: z.string().optional().describe('Search name, email, company or message.'),
    ...pageArgs,
  },
  annotations: READ,
  run: async (args, ctx) => {
    const res = await ctx.client.get<{ items: unknown[]; total: number; page: number; pageSize: number; counts: unknown }>('/inquiries', args);
    return { items: res.items, countsByStatus: res.counts, ...paging(res.total, res.page, res.pageSize) };
  },
});

export const getInquiry = defineTool({
  name: 'get_inquiry',
  title: 'Get inquiry',
  description: `One inquiry in full: contact details, products and quantities, message, source page, UTM and the notes of the sales team. ${PRIVACY}`,
  requires: ['inquiries.read'],
  capability: 'inquiries',
  input: { id: z.string().describe('Inquiry id.') },
  annotations: READ,
  run: ({ id }, ctx) => ctx.client.get(`/inquiries/${seg(id)}`),
});

export const inquiryTools = [listInquiries, getInquiry];
