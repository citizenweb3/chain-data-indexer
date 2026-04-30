import type { EventHandler } from "@chicmoz-pkg/message-bus";
import type { ChicmozMessageBusPayload } from "@chicmoz-pkg/message-registry";
import { startSubscribe } from "../../svcs/message-bus/index.js";
import { observeBusConsume } from "../../metrics/registry.js";
import { blockHandler, catchupHandler } from "./on-block/index.js";
import { chainInfoHandler } from "./on-chain-info.js";
import { contractInstanceBalanceHandler } from "./on-contract-instance-balance.js";
import { droppedTxHandler } from "./on-dropped-txs.js";
import { l1L2ValidatorHandler } from "./on-l1-l2-validator.js";
import {
  l1GenericContractEventHandler,
  l1L2BlockProposedHandler,
  l1L2ProofVerifiedHandler,
} from "./on-l1-rollup-contract-events.js";
import {
  l2RpcNodeAliveHandler,
  l2RpcNodeErrorHandler,
} from "./on-l2-rpc-node.js";
import { pendingTxHandler } from "./on-pending-txs.js";
import { sequencerInfoHandler } from "./on-sequencer-info.js";

const instrument = (h: EventHandler): EventHandler => {
  const originalCb = h.cb;
  return {
    ...h,
    cb: async (arg: ChicmozMessageBusPayload) => {
      const startedAt = process.hrtime.bigint();
      try {
        await originalCb(arg);
        observeBusConsume(
          h.topic,
          "ok",
          Number(process.hrtime.bigint() - startedAt) / 1e9,
        );
      } catch (e) {
        observeBusConsume(
          h.topic,
          "error",
          Number(process.hrtime.bigint() - startedAt) / 1e9,
        );
        throw e;
      }
    },
  };
};

export const subscribeHandlers = async () => {
  await Promise.all([
    startSubscribe(instrument(chainInfoHandler)),
    startSubscribe(instrument(sequencerInfoHandler)),
    startSubscribe(instrument(l2RpcNodeAliveHandler)),
    startSubscribe(instrument(l2RpcNodeErrorHandler)),
    startSubscribe(instrument(blockHandler)),
    startSubscribe(instrument(catchupHandler)),
    startSubscribe(instrument(pendingTxHandler)),
    startSubscribe(instrument(droppedTxHandler)),
    startSubscribe(instrument(contractInstanceBalanceHandler)),
    startSubscribe(instrument(l1L2ValidatorHandler)),
    startSubscribe(instrument(l1L2BlockProposedHandler)),
    startSubscribe(instrument(l1L2ProofVerifiedHandler)),
    startSubscribe(instrument(l1GenericContractEventHandler)),
  ]);
};
