import { createAlchemyWeb3 } from "@alch/alchemy-web3";
import axios from "axios";
import { AbiItem } from "web3-utils";
import { ADDRESSES, asyncForEach, COMMON_DECIMALS } from "./stuff";
const ERC20ABI = require("../abi/ERC20");
const TokenSetABI = require("../abi/TokenSetABI");

export const alchemyApiKey = process.env.ALCHEMY_API_KEY || "";
export const baseUrl0x: string = process.env.BASE_URL_0X || "";
export const web3 = createAlchemyWeb3(
  "https://polygon-mainnet.g.alchemy.com/v2/" + alchemyApiKey
);
console.log(baseUrl0x, alchemyApiKey);
export const getDecimals = async (addr: string): Promise<string> => {
  if (addr in COMMON_DECIMALS) {
    return COMMON_DECIMALS[addr];
  }
  const contract = new web3.eth.Contract(ERC20ABI as AbiItem[], addr);
  const decimals: string = await contract.methods
    .decimals()
    .call((err: any, res: string) => {
      if (err) {
        console.log("An error occured", err);
      }
      return res;
    });
  return decimals;
};

// Get TokenPrice for address
const getTokenPrice = async (
  data: string | { decimals: number; tokenAddress: string; symbol: string }[],
  stepSize: number,
  stepCount: number
): Promise<{ symbol: string; prices: number[] }[]> => {
  if (typeof data === "string") {
    data = data.toLowerCase();
    const decimals = await getDecimals(data);
    data = [
      { decimals: parseInt(decimals, 10), tokenAddress: data, symbol: "" },
    ];
  }

  const price = await axios
    .post(baseUrl0x + `/history`, {
      buyTokens: data,
      stepSize: stepSize,
      stepCount: stepCount,
    })
    .then((response) => {
      return response.data; // return price and decimals
    })
    .catch((err) => console.log(err.response.data));
  return price;
};

const getTokenSetPositions = async (
  contractAddr: string,
  block: number | undefined
) => {
  let token;
  // if (past) {
  //   token = new web3.eth.Contract(TokenSetABI as AbiItem[], contractAddr);
  //   const latest: number = await web3.eth.getBlockNumber();
  //   pastBlock = latest - 37565;
  // } else {
  token = new web3.eth.Contract(TokenSetABI as AbiItem[], contractAddr);
  // }
  const result = await token.methods
    .getPositions()
    .call(block, (err: any, res: any) => {
      if (err) {
        console.log("An error occurred", err);
      }
      return res;
    });
  let r: { component: string; unit: string }[] = [];
  result.forEach((element: { component: string; unit: string }) => {
    r.push({ component: element.component, unit: element.unit });
  });
  return r;
};

const getTokenSetHistory = async (
  contractAddr: string,
  stepSize: number,
  stepCount: number
) => {
  const latest: number = await web3.eth.getBlockNumber();
  let masterObj = [];
  for (var i = 0; i <= stepCount; i++) {
    var block = latest - stepSize * i;
    masterObj.push(await getTokenSetPositions(contractAddr, block));
  }
  return masterObj;
};

const getAllTSComponents = (
  masterObj: {
    component: string;
    unit: string;
  }[][]
) => {
  let components: string[] = [];
  masterObj.forEach((e) => {
    e.forEach((deeperE) => {
      if (!components.includes(deeperE.component)) {
        components.push(deeperE.component);
      }
    });
  });
  return components;
};

const getPriceHistoryForComponents = async (
  components: string[],
  stepSize: number,
  stepCount: number
) => {
  var obj: { decimals: number; tokenAddress: string; symbol: string }[] = [];
  await asyncForEach(components, async (component) => {
    obj.push({
      decimals: parseInt(await getDecimals(component), 10),
      tokenAddress: component,
      symbol: component,
    });
  });
  return getTokenPrice(obj, stepSize, stepCount);
};

const calculatePriceHistory = async (
  masterObj: {
    component: string;
    unit: string;
  }[][],
  allPrices: { symbol: string; prices: number[] }[]
) => {
  let prices: number[] = [];
  await asyncForEach(masterObj, async (o, i) => {
    let price = 0;
    await asyncForEach(o, async (e, index) => {
      let amount =
        parseInt(e.unit) / 10 ** parseInt(await getDecimals(e.component));
      let p = allPrices[index].prices[i];
      price += amount * p;
    });
    // await masterObj[i].forEach(async (e, index) => {
    //   price +=
    //     (parseInt(e.unit) / 10 ** parseInt(await getDecimals(e.component))) *
    //     allPrices[index].prices[i];
    // });
    prices.push(price);
  });
  return prices;
};

const getFullTokenSetPriceHistory = async (
  contractAddr: string,
  stepSize: number,
  stepCount: number
) => {
  const tokenSetHistory = await getTokenSetHistory(
    contractAddr,
    stepSize,
    stepCount
  );
  const components = getAllTSComponents(tokenSetHistory);
  const allPrices = await getPriceHistoryForComponents(
    components,
    stepSize,
    stepCount
  );
  // console.log(tokenSetHistory);
  // console.log(components);
  // console.log(allPrices);
  return await calculatePriceHistory(tokenSetHistory, allPrices);
};

export const chartingEngine = async (
  contractAddr: string,
  stepSize: number,
  stepCount: number
) => {
  let prices: number[];
  let response: { date: number | string; price: number }[] = [];
  if (ADDRESSES.includes(contractAddr.toLowerCase())) {
    prices = await getFullTokenSetPriceHistory(
      contractAddr,
      stepSize,
      stepCount
    );
  } else {
    const p = await getTokenPrice(contractAddr, stepSize, stepCount);
    prices = p[0].prices;
  }
  prices.forEach((price, index) => {
    var epoch = new Date().getTime();
    epoch = epoch - stepSize * 23 * index * 100;
    var date = new Date(epoch);
    const timestamp = `${date.getUTCFullYear()}-${
      date.getUTCMonth() + 1
    }-${date.getUTCDate()}`;
    response.push({ date: timestamp, price: price });
  });
  return response;
};

// getDecimals => get Decimals
// getTokenPrice => get Token Price (data,stepSize, stepCount) stepSize = 37565 1 Day --- data can be only tokenAddress or {tokenaddress, decimals, symbol}
// getTokenSetPositions => get TokenSet Position (TokenSet, Block | undefined)
// getTokenSetHistory => call getTokenSetPositions (contractAddr,stepSize, stepCount) stepSize = 37565 1 Day
// getAllTSComponents => get all Token Addresses used in the Tokenset over set period of time (masterObj(getTokenSetHistory response)) returns [addr,addr,...]
// getPriceHistoryForComponents => takes getAllTSComponents, stepSize, stepCount and returns getTokenPrice for all components. Uses contractAddr as symbol
// calculatePriceHistory => takes getTokenSetHistory, getPriceHistoryForComponents and returns calculated prce history [price,price,...]
// getFullTokenSetPriceHistory => Takes TokenSetAddress Only, stepSize and SetCount, return [] of prices

// (async () =>
//   console.log(
//     await chartingEngine("0x25Ad32265c9354c29e145c902aE876f6B69806F2", 37565, 3)
//   ))();