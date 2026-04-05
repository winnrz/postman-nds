import { PrismaClientKnownRequestError } from "@prisma/client/runtime/wasm-compiler-edge";

// P2002 is Prisma's unique constraint violation code
function isUniqueConstraintError(
  err: unknown,
): err is PrismaClientKnownRequestError {
  return err instanceof PrismaClientKnownRequestError && err.code === "P2002";
}

export { isUniqueConstraintError };