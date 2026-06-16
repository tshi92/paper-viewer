declare module "@prisma/client" {
  export class PrismaClient {
    constructor(options?: {
      log?: Array<"query" | "error" | "warn">;
    });

    $disconnect(): Promise<void>;
  }
}
