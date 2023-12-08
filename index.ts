import { JSDOM } from "jsdom";
import { Axios } from "axios";
import { createWriteStream } from "fs";
import { convertHtmlToDelta } from "node-quill-converter";
import { exit } from "process";

type Iterableify<T> = { [K in keyof T]: Iterable<T[K]> };

function* zip<T extends Array<any>>(...toZip: Iterableify<T>): Generator<T> {
  // Get iterators for all of the iterables.
  const iterators = toZip.map((i) => i[Symbol.iterator]());

  while (true) {
    // Advance all of the iterators.
    const results = iterators.map((i) => i.next());

    // If any of the iterators are done, we should stop.
    if (results.some(({ done }) => done)) {
      break;
    }

    // We can assert the yield type, since we know none
    // of the iterators are done.
    yield results.map(({ value }) => value) as T;
  }
}

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
        artPost?.querySelector<HTMLHeadingElement>("h2")?.textContent;
      const body = artPost?.outerHTML ?? "";
      const pdfs = [
        ...(artPost?.querySelectorAll<HTMLAnchorElement>("a[href$='.pdf']") ??
          []),
      ].map((node) =>
        decodeURI(`https://www.khidmat-almostahlik.ma${node.href}`)
      );

      const description = artPost?.querySelector("p")?.textContent ?? "";
      const images = Array.from(
        artPost?.querySelectorAll<HTMLImageElement>("img") ?? []
      ).map(({ src }) => decodeURI(src.replace("/styles/medium/public", "")));

      const nextLink =
        document.querySelector<HTMLAnchorElement>('a[xml\\:lang="ar"]')?.href;
      const slug = endpoint.substring(11).replace(/\//g, "-");
      return {
        pdfs,
        title,
        description: description ?? title,
        images,
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
      let translations: any = [];

      const frenchData = await this.getPage(node.href, "fr");
      translations.push(frenchData);
      if (frenchData?.nextLink) {
        const arabicData = await this.getPage(frenchData.nextLink, "ar");
        if (arabicData) {
          delete frenchData["nextLink"];
          delete arabicData["nextLink"];
          translations.push(arabicData);
          this.renameDuplicateSlug(translations);
        }
      }
      arr.push({
        type: "PAGE",
        translations: translations,
      });
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

  async getPageByEndpoint(endpoint: string, type: "PAGE" | "ARTICLE") {
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
  async getArticlePages(
    arr: unknown[],
    nodes: (HTMLAnchorElement | null)[],
    dates: (HTMLSpanElement | null)[]
  ) {
    for (const [node, date] of zip(nodes, dates)) {
      if (!node || !date) continue;
      let translations: any = [];

      const frenchData = await this.getPage(node.href, "fr");
      translations.push(frenchData);
      if (frenchData?.nextLink) {
        const arabicData = await this.getPage(frenchData.nextLink, "ar");
        if (arabicData) {
          delete frenchData["nextLink"];
          delete arabicData["nextLink"];
          translations.push(arabicData);
          this.renameDuplicateSlug(translations);
        }
      }
      arr.push({
        type: "ARTICLE",
        createdAt: new Date(
          date.getAttribute("content")?.substring(0, 10) ?? new Date()
        ),
        translations: translations,
      });
    }
  }

  async getArticles() {
    const arr: unknown[] = [];
    try {
      const resp = await this.get("/portal/fr/actualites");
      const {
        window: { document },
      } = new JSDOM(resp.data);
      const articles = Array.from(
        document.querySelectorAll(".art-post")[1].querySelectorAll(".views-row")
      );
      const nodes = articles.map((document) =>
        document.querySelector<HTMLAnchorElement>(".more-link-actualite > a")
      );
      const dates = articles.map((document) =>
        document.querySelector<HTMLSpanElement>(".date-display-single")
      );

      console.log(nodes.length, dates.length);
      if (nodes) await this.getArticlePages(arr, nodes, dates);
    } catch (err) {
      console.error(err);
    }
    return arr;
  }
}

async function main() {
  const scrapper = new Scrapper();
  // //  pages data
  // const data = (
  //   await Promise.all([
  //     scrapper.getPageByEndpoint("/portal/fr/propos-du-portail", "PAGE"),
  //     scrapper.getRegulations(),
  //     scrapper.getRights(),
  //     scrapper.getPageByEndpoint(
  //       "/portal/fr/association-de-protection-du-consommateur-pour-quoi-faire",
  //       "PAGE"
  //     ),
  //     scrapper.getPageByEndpoint("/portal/fr/faq", "PAGE"),
  //     scrapper.getPageByEndpoint("/portal/fr/mentions-légales", "PAGE"),
  //   ])
  // ).reduce((acc, value) => {
  //   acc.push(...value);
  //   return acc;
  // }, []);

  // articles data
  const data = await scrapper.getArticles();

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
