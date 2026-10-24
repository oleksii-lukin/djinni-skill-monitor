import { PrismaClient } from "@prisma/client";

// Синглтон Prisma-клиента (для tsx-скриптов без hot-reload)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
