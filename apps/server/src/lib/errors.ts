// lib/errors.ts
import { TRPCError } from "@trpc/server";

export class BoxLoyalError extends Error {
    public readonly code: string;
    public readonly statusCode: number;
    public readonly context?: Record<string, any>;

    constructor(
        message: string,
        code: string,
        statusCode: number = 500,
        context?: Record<string, any>
    ) {
        super(message);
        this.name = "BoxLoyalError";
        this.code = code;
        this.statusCode = statusCode;
        this.context = context;
    }
}

export class ValidationError extends BoxLoyalError {
    constructor(message: string, field?: string) {
        super(message, "VALIDATION_ERROR", 400, { field });
    }
}

export class AuthenticationError extends BoxLoyalError {
    constructor(message: string = "Authentication required") {
        super(message, "AUTHENTICATION_ERROR", 401);
    }
}

export class AuthorizationError extends BoxLoyalError {
    constructor(message: string = "Insufficient permissions") {
        super(message, "AUTHORIZATION_ERROR", 403);
    }
}

export class ResourceNotFoundError extends BoxLoyalError {
    constructor(resource: string, id?: string) {
        const message = id
            ? `${resource} with ID ${id} not found`
            : `${resource} not found`;
        super(message, "RESOURCE_NOT_FOUND", 404, { resource, id });
    }
}

export class ConflictError extends BoxLoyalError {
    constructor(message: string, conflictingField?: string) {
        super(message, "CONFLICT_ERROR", 409, { conflictingField });
    }
}

export class RateLimitError extends BoxLoyalError {
    constructor(message: string = "Rate limit exceeded") {
        super(message, "RATE_LIMIT_ERROR", 429);
    }
}

export class ExternalServiceError extends BoxLoyalError {
    constructor(service: string, originalError?: Error) {
        super(
            `External service error: ${service}`,
            "EXTERNAL_SERVICE_ERROR",
            502,
            { service, originalError: originalError?.message }
        );
    }
}

// Convert BoxLoyalError to TRPCError
export function toTRPCError(error: BoxLoyalError): TRPCError {
    const trpcCodeMap: Record<string, TRPCError["code"]> = {
        VALIDATION_ERROR: "BAD_REQUEST",
        AUTHENTICATION_ERROR: "UNAUTHORIZED",
        AUTHORIZATION_ERROR: "FORBIDDEN",
        RESOURCE_NOT_FOUND: "NOT_FOUND",
        CONFLICT_ERROR: "CONFLICT",
        RATE_LIMIT_ERROR: "TOO_MANY_REQUESTS",
        EXTERNAL_SERVICE_ERROR: "INTERNAL_SERVER_ERROR",
    };

    return new TRPCError({
        code: trpcCodeMap[error.code] || "INTERNAL_SERVER_ERROR",
        message: error.message,
        cause: error,
    });
}
