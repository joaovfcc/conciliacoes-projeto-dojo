/**
 * V2 Adapter Registry
 *
 * Centralizes all V2 PDF (and future CSV) adapters and creates
 * the StatementSourceAdapterRegistry used by the processing pipeline.
 */

import { StatementSourceAdapterRegistry, type StatementSourceAdapter } from "../statement-sources.js"
import { abcCurrentAccountAdapter, abcLinkedAccountAdapter } from "./abc.js"
import { bbCurrentAccountAdapter, bbRendeFacilAdapter } from "./bb.js"
import { bmpCurrentAccountAdapter } from "./bmp.js"
import { bocomAnalyticCurrentAccountAdapter, bocomEmptyCurrentAccountAdapter } from "./bocom.js"
import { caixaCurrentAccountAdapter, caixaFundStatementAdapter } from "./caixa.js"
import { daycovalCurrentAccountAdapter } from "./daycoval.js"
import { guanabaraCurrentAccountAdapter, guanabaraLinkedAccountAdapter } from "./guanabara.js"
import { bradescoCurrentAccountAdapter } from "./bradesco-cc.js"
import { bradescoInvestmentAdapter } from "./bradesco-investment.js"
import { brbCurrentAccountAdapter } from "./brb-cc.js"
import { bmgCurrentAccountAdapter } from "./bmg-cc.js"
import { bmgPositionAdapter } from "./bmg-position.js"
import { itauCurrentAccountAdapter } from "./itau-cc.js"
import { itauInvestmentAdapter } from "./itau-investment.js"
import { santanderCurrentAccountAdapter } from "./santander-cc.js"
import { santanderInvestmentAdapter } from "./santander-investment.js"
import { sofisaCurrentAccountAdapter } from "./sofisa-cc.js"
import { sofisaPositionAdapter } from "./sofisa-position.js"

/**
 * All registered V2 adapters.
 * Add new adapters here as they are implemented.
 */
export const registeredV2Adapters: readonly StatementSourceAdapter[] = [
  abcCurrentAccountAdapter,
  abcLinkedAccountAdapter,
  bbCurrentAccountAdapter,
  bbRendeFacilAdapter,
  bmpCurrentAccountAdapter,
  bocomAnalyticCurrentAccountAdapter,
  bocomEmptyCurrentAccountAdapter,
  caixaCurrentAccountAdapter,
  caixaFundStatementAdapter,
  daycovalCurrentAccountAdapter,
  guanabaraCurrentAccountAdapter,
  guanabaraLinkedAccountAdapter,
  bradescoCurrentAccountAdapter,
  bradescoInvestmentAdapter,
  brbCurrentAccountAdapter,
  itauCurrentAccountAdapter,
  itauInvestmentAdapter,
  santanderCurrentAccountAdapter,
  santanderInvestmentAdapter,
  sofisaCurrentAccountAdapter,
  sofisaPositionAdapter,
  bmgCurrentAccountAdapter,
  bmgPositionAdapter,
]

/**
 * The V2 adapter registry instance, ready for use in the processing pipeline.
 */
export const v2AdapterRegistry = new StatementSourceAdapterRegistry(registeredV2Adapters)

export { bradescoCurrentAccountAdapter } from "./bradesco-cc.js"
export { abcCurrentAccountAdapter, abcLinkedAccountAdapter } from "./abc.js"
export { bbCurrentAccountAdapter, bbRendeFacilAdapter } from "./bb.js"
export { bmpCurrentAccountAdapter } from "./bmp.js"
export { bocomAnalyticCurrentAccountAdapter, bocomEmptyCurrentAccountAdapter } from "./bocom.js"
export { caixaCurrentAccountAdapter, caixaFundStatementAdapter } from "./caixa.js"
export { daycovalCurrentAccountAdapter } from "./daycoval.js"
export { guanabaraCurrentAccountAdapter, guanabaraLinkedAccountAdapter } from "./guanabara.js"
export { bradescoInvestmentAdapter } from "./bradesco-investment.js"
export { brbCurrentAccountAdapter } from "./brb-cc.js"
export { bmgCurrentAccountAdapter } from "./bmg-cc.js"
export { bmgPositionAdapter } from "./bmg-position.js"
export { itauCurrentAccountAdapter } from "./itau-cc.js"
export { itauInvestmentAdapter } from "./itau-investment.js"
export { santanderCurrentAccountAdapter } from "./santander-cc.js"
export { santanderInvestmentAdapter } from "./santander-investment.js"
export { sofisaCurrentAccountAdapter } from "./sofisa-cc.js"
export { sofisaPositionAdapter } from "./sofisa-position.js"
