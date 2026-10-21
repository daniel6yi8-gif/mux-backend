import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
  Logger,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { FeeSponsorshipService } from './fee-sponsorship.service';
import { CreateFeeSponsorshipBudgetDto } from './dto/create-fee-sponsorship-budget.dto';
import { UpdateFeeSponsorshipBudgetDto } from './dto/update-fee-sponsorship-budget.dto';
import {
  FeeSponsorshipBudgetResponse,
  FeeSponsorshipBudgetPageResponse,
} from './dto/fee-sponsorship-budget-response.dto';
import { ListFeeSponsorshipBudgetsQueryDto } from './dto/list-fee-sponsorship-budgets-query.dto';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import {
  FeeSponsorshipNetwork,
  SponsorshipActor,
} from './domain/fee-sponsorship-budget.model';
import { FeeSponsorshipErrorCode } from './fee-sponsorship-error-codes';
import { randomUUID } from 'crypto';

/**
 * REST controller for fee sponsorship budget operations.
 *
 * All endpoints require API key authentication (ApiKeyGuard).
 * All write operations are gated by the FEE_SPONSORSHIP_ENABLED
 * feature flag for mainnet.
 *
 * Invariants:
 * - Deny-by-default for all privileged surfaces.
 * - Stable error codes in every failure response.
 * - Correlation ids echoed back on every response.
 * - No secrets or raw key material in responses.
 */
@Controller('fee-sponsorship')
export class FeeSponsorshipController {
  private readonly logger = new Logger(FeeSponsorshipController.name);

  constructor(private readonly feeSponsorshipService: FeeSponsorshipService) {}

  /**
   * Create a fee sponsorship budget.
   *
   * POST /v1/fee-sponsorship
   *
   * Requires API key authentication.
   * Mainnet writes require the FEE_SPONSORSHIP_ENABLED feature flag.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  async createBudget(
    @Body() body: CreateFeeSponsorshipBudgetDto,
    @Req() req: Request,
  ): Promise<FeeSponsorshipBudgetResponse> {
    const actor = this.extractActor(req, body.idempotencyKey);
    const result = await this.feeSponsorshipService.createBudget(body, actor);
    return this.toResponse(result);
  }

  /**
   * Get a fee sponsorship budget by ID.
   *
   * GET /v1/fee-sponsorship/:id
   *
   * Requires API key authentication.
   */
  @Get(':id')
  @UseGuards(ApiKeyGuard)
  async getBudget(
    @Param('id') id: string,
    @Query('idempotencyKey') idempotencyKey: string | undefined,
    @Req() req: Request,
  ): Promise<FeeSponsorshipBudgetResponse> {
    const actor = this.extractActor(req, idempotencyKey);
    const result = await this.feeSponsorshipService.getBudget(id, actor);
    return this.toResponse(result);
  }

  /**
   * List fee sponsorship budgets for a wallet, cursor-paginated.
   *
   * GET /v1/fee-sponsorship?walletId=<id>&network=MAINNET|TESTNET&limit=20&cursor=<budgetId>
   *
   * Requires API key authentication.
   * Returns `{ items, nextCursor }`; `nextCursor` is null on the last page.
   */
  @Get()
  @UseGuards(ApiKeyGuard)
  async listBudgets(
    @Query() query: ListFeeSponsorshipBudgetsQueryDto,
  ): Promise<FeeSponsorshipBudgetPageResponse> {
    const actor = this.extractActor({ walletId: query.walletId });
    const page = await this.feeSponsorshipService.listBudgets(
      query.walletId,
      actor,
      query.network,
      { limit: query.limit, cursor: query.cursor },
    );
    return {
      items: page.items.map((b) => this.toResponse(b)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Update a fee sponsorship budget.
   *
   * PATCH /v1/fee-sponsorship/:id
   *
   * Requires API key authentication.
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  async updateBudget(
    @Param('id') id: string,
    @Body() body: UpdateFeeSponsorshipBudgetDto,
    @Req() req: Request,
  ): Promise<FeeSponsorshipBudgetResponse> {
    const actor = this.extractActor(req, body.idempotencyKey);
    const result = await this.feeSponsorshipService.updateBudget(id, body, actor);
    return this.toResponse(result);
  }

  /**
   * Close (deactivate) a fee sponsorship budget.
   *
   * POST /v1/fee-sponsorship/:id/close
   *
   * Requires API key authentication.
   * Idempotent: closing an already-closed budget returns the existing budget.
   */
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  async closeBudget(
    @Param('id') id: string,
    @Body() body: { idempotencyKey?: string },
    @Req() req: Request,
  ): Promise<FeeSponsorshipBudgetResponse> {
    const actor = this.extractActor(req, body.idempotencyKey);
    const result = await this.feeSponsorshipService.closeBudget(id, actor);
    return this.toResponse(result);
  }

  /**
   * Derive the actor from the API key authenticated by ApiKeyGuard.
   *
   * The subject is the developer that owns the key. Client-supplied body or
   * query fields are never trusted for identity; they are only used as the
   * budget's sponsor field and checked against this subject in the service.
   * Requests with no resolvable developer are rejected, never attributed to a
   * placeholder subject.
   */
  private extractActor(req: Request, idempotencyKey?: string): SponsorshipActor {
    const developerId: unknown = (req as any).apiKeyContext?.developerId;
    if (typeof developerId !== 'string' || developerId.length === 0) {
      throw new UnauthorizedException({
        code: FeeSponsorshipErrorCode.UNATTRIBUTED_ACTOR,
        message: 'Request is not attributable to an authenticated developer',
      });
    }
    return {
      subjectId: developerId,
      role: 'owner',
      correlationId: idempotencyKey,
    };
  }

  /**
   * Convert a domain model to the API response DTO.
   */
  private toResponse(budget: any): FeeSponsorshipBudgetResponse {
    return {
      id: budget.id,
      walletId: budget.walletId,
      sponsorId: budget.sponsorId,
      limitAmount: budget.limitAmount,
      remainingAmount: budget.remainingAmount,
      assetCode: budget.assetCode,
      assetIssuer: budget.assetIssuer,
      network: budget.network,
      status: budget.status,
      note: budget.note,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    };
  }
}
