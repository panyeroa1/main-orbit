"use client";

import { MeetingTypeList } from "@/components/meeting-type-list";
import { useGetCalls } from "@/hooks/use-get-calls";

const HomePage = () => {
  const now = new Date();
  const { upcomingCalls } = useGetCalls();

  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
    now
  );

  return (
    <section className="flex size-full flex-col gap-10 text-white">
      <div className="relative h-[320px] w-full overflow-hidden rounded-[20px] border border-white/10 bg-gradient-to-br from-[#0B0D10] via-[#171A1F] to-[#0B0D10]">
        <div className="pointer-events-none absolute inset-0 opacity-50">
          <div className="absolute -left-16 top-12 h-48 w-48 rounded-full border border-white/10" />
          <div className="absolute right-10 top-10 h-24 w-24 rounded-full border border-white/5" />
          <div className="absolute bottom-6 left-24 h-16 w-16 rounded-full border border-white/5" />
        </div>

        <div className="relative flex h-full flex-col justify-between max-md:px-5 max-md:py-8 lg:p-11">
          <h2 className="rounded-md border border-white/10 bg-black/50 px-4 py-2 text-center text-base font-medium text-white/80 backdrop-blur">
            {upcomingCalls?.length === 0
              ? "No upcoming meeting"
              : upcomingCalls?.length &&
                `Upcoming meeting at: 
                ${upcomingCalls[
                  upcomingCalls.length - 1
                ].state?.startsAt?.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`}
          </h2>

          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-semibold text-white lg:text-7xl">
              {time}
            </h1>

            <p className="text-lg font-medium text-white/60 lg:text-2xl">
              {date}
            </p>
          </div>
        </div>
      </div>

      <MeetingTypeList />
    </section>
  );
};

export default HomePage;
