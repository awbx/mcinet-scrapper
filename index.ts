import { JSDOM } from "jsdom";
import { Axios } from "axios";
import { createWriteStream } from "fs";
import { convertHtmlToDelta } from "node-quill-converter";
import { exit } from "process";

export class Scrapper extends Axios {
  constructor() {
    super({
      baseURL: "https://www.khidmat-almostahlik.ma",
    });
  }

  async getPage(endpoint: string, locale: string) {
    try {
      console.debug(`[${locale}] - Getting ${decodeURI(endpoint)}`);
      const resp = await this.get(endpoint);

      endpoint = decodeURI(endpoint);

      const {
        window: { document },
      } = new JSDOM(resp.data);

      const artPost = document.querySelectorAll(".art-post")[1];
      const title =
        artPost?.querySelector<HTMLHeadingElement>("h2")?.textContent ?? "";
      const body = artPost?.outerHTML ?? "";
      const pdfs = [
        ...(artPost?.querySelectorAll<HTMLAnchorElement>("a[href$='.pdf']") ??
          []),
      ].map((node) =>
        decodeURI(`https://www.khidmat-almostahlik.ma${node.href}`)
      );

      const nextLink =
        document.querySelector<HTMLAnchorElement>('a[xml\\:lang="ar"]')?.href;
      const slug = endpoint.substring(11).replace(/\//g, "-");
      return {
        pdfs,
        title,
        slug,
        endpoint,
        content: {
          blocks: [
            {
              id: "g8c8m6G-7v",
              type: "legacy",
              data: {
                body: [...convertHtmlToDelta(body).ops],
              },
            },
          ],
          time: 1686324729267,
          version: "2.26.5",
        },
        body,
        i18nLocaleId: locale,
        nextLink,
      };
    } catch (err) {
      console.error(err);
    }
  }

  async getPages(arr: unknown[], nodes: NodeListOf<HTMLAnchorElement>) {
    for (const node of nodes) {
      const frenchData = await this.getPage(node.href, "fr");
      if (frenchData?.nextLink) {
        const arabicData = await this.getPage(frenchData.nextLink, "ar");
        if (arabicData) {
          delete frenchData["nextLink"];
          delete arabicData["nextLink"];
          arr.push({
            type: "PAGE",
            translations: this.renameDuplicateSlug([frenchData, arabicData]),
          });
        }
      }
    }
  }

  private renameDuplicateSlug(arr: { slug: string }[]) {
    if (arr.length == 2 && arr[0].slug === arr[1].slug) {
      arr[1].slug = `ar-${arr[1].slug}`;
    }
    return arr;
  }

  async getRegulations() {
    const arr: unknown[] = [];
    try {
      const resp = await this.get("/portal/fr/sitemap");
      const {
        window: { document },
      } = new JSDOM(resp.data);
      const nodes = document
        .querySelector(".site-map-menu .expanded")
        ?.querySelectorAll<HTMLAnchorElement>(".leaf a");
      if (nodes) await this.getPages(arr, nodes);
    } catch (err) {
      console.error(err);
    }
    return arr;
  }

  async getRights() {
    const arr: unknown[] = [];
    try {
      const resp = await this.get("/portal/fr/sitemap");
      const {
        window: { document },
      } = new JSDOM(resp.data);

      const nodes = document
        .querySelectorAll(".site-map-menu .expanded")[8]
        ?.querySelectorAll<HTMLAnchorElement>(".leaf a");
      if (nodes) await this.getPages(arr, nodes);
    } catch (err) {
      console.error(err);
    }
    return arr;
  }

  async getPageByEndpoint(endpoint: string) {
    const arr: unknown[] = [];
    const {
      window: { document },
    } = new JSDOM();
    const anchor = document.createElement("a");
    anchor.href = endpoint;
    const nodes = [anchor] as unknown as NodeListOf<HTMLAnchorElement>;
    await this.getPages(arr, nodes);
    return arr;
  }
}

async function main() {
  const scrapper = new Scrapper();
  const data = (
    await Promise.all([
      scrapper.getPageByEndpoint("/portal/fr/propos-du-portail"),
      scrapper.getRegulations(),
      scrapper.getRights(),
      scrapper.getPageByEndpoint(
        "/portal/fr/association-de-protection-du-consommateur-pour-quoi-faire"
      ),
      scrapper.getPageByEndpoint("/portal/fr/faq"),
      scrapper.getPageByEndpoint("/portal/fr/mentions-légales"),
    ])
  ).reduce((acc, value) => {
    acc.push(...value);
    return acc;
  }, []);

  const stream = createWriteStream("./data.json", {
    autoClose: true,
  });
  console.log(`Wrote ${data.length} records.`);
  stream.write(JSON.stringify(data, null, 2), (err) => {
    if (err) console.error(err);
    stream.close();
    exit(0);
  });
}

main().catch(console.error);
