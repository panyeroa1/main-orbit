"use client";

import { useUser } from "@clerk/nextjs";
import { type Call, useStreamVideoClient } from "@stream-io/video-react-sdk";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ReactDatePicker from "react-datepicker";

import { MeetingModal } from "@/components/modals/meeting-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";

import { HomeCard } from "./home-card";
import { Loader } from "./loader";

type MeetingState =
  | "isScheduleMeeting"
  | "isJoiningMeeting"
  | "isInstantMeeting"
  | undefined;

export const MeetingTypeList = () => {
  const router = useRouter();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [callDetails, setCallDetails] = useState<Call>();
  const [meetingState, setMeetingState] = useState<MeetingState>(undefined);
  const [values, setValues] = useState({
    dateTime: new Date(),
    description: "",
    link: "",
  });

  const { user } = useUser();
  const streamClient = useStreamVideoClient();

  const createMeeting = async () => {
    if (!streamClient || !user || !user?.id) return;

    try {
      setIsLoading(true);

      if (!values.dateTime) {
        return toast({
          title: "Please select a date and time.",
          variant: "destructive",
        });
      }

      const id = crypto.randomUUID();
      const call = streamClient.call("default", id);

      if (!call) throw new Error("Failed to create call.");

      const startsAt =
        values.dateTime.toISOString() || new Date(Date.now()).toISOString();
      const description = values.description || "Instant meeting";

      await call.getOrCreate({
        data: {
          starts_at: startsAt,
          custom: {
            description,
          },
        },
      });

      setCallDetails(call);

      if (!values?.description) {
        router.push(`/meeting/${call.id}`);
      }

      toast({
        title: "Meeting created.",
      });
    } catch (error) {
      console.error("CREATE_MEETING: ", error);

      toast({
        title: "Failed to create meeting.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!streamClient || !user || !user?.id) return <Loader />;

  const meetingLink = `${process.env.NEXT_PUBLIC_BASE_URL}/meeting/${callDetails?.id}`;

  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      <HomeCard
        img="/icons/add-meeting.svg"
        title="New Meeting"
        description="Start an instant meeting"
        handleClick={createMeeting}
        className="border border-white/10 bg-gradient-to-br from-[#0B0D10] via-[#15181D] to-[#0B0D10] hover:border-white/20"
      />

      <HomeCard
        img="/icons/schedule.svg"
        title="Schedule Meeting"
        description="Plan your meeting"
        handleClick={() => setMeetingState("isScheduleMeeting")}
        className="border border-white/10 bg-gradient-to-br from-[#0B0D10] via-[#171B22] to-[#0B0D10] hover:border-white/20"
      />

      <HomeCard
        img="/icons/recordings.svg"
        title="View Recordings"
        description="Check out your recordings"
        handleClick={() => router.push("/recordings")}
        className="border border-white/10 bg-gradient-to-br from-[#0B0D10] via-[#141820] to-[#0B0D10] hover:border-white/20"
      />

      <HomeCard
        img="/icons/join-meeting.svg"
        title="Join Meeting"
        description="Via invitation link"
        handleClick={() => setMeetingState("isJoiningMeeting")}
        className="border border-white/10 bg-gradient-to-br from-[#0B0D10] via-[#151A22] to-[#0B0D10] hover:border-white/20"
      />

      {!callDetails ? (
        <MeetingModal
          isOpen={meetingState === "isScheduleMeeting"}
          onClose={() => setMeetingState(undefined)}
          title="Create meeting"
          handleClick={createMeeting}
          isLoading={isLoading}
        >
          <div className="flex flex-col gap-2.5">
            <label className="text-normal text-base leading-[22px] text-sky-2">
              Add a description
              <Textarea
                rows={6}
                placeholder="Add a description..."
                className="mt-2 resize-none border-none bg-dark-3"
                onChange={(e) => {
                  setValues({ ...values, description: e.target.value });
                }}
              />
            </label>
          </div>

          <div className="flex w-full flex-col gap-2.5">
            <label className="text-normal flex flex-col text-base leading-[22px] text-sky-2">
              Select Date and Time
              <ReactDatePicker
                selected={values.dateTime}
                onChange={(date) =>
                  setValues({
                    ...values,
                    dateTime: date!,
                  })
                }
                showTimeSelect
                timeFormat="HH:mm"
                timeIntervals={15}
                timeCaption="time"
                dateFormat="MMMM d, yyyy h:mm aa"
                className="mt-2 w-full rounded bg-dark-3 p-2"
              />
            </label>
          </div>
        </MeetingModal>
      ) : (
        <MeetingModal
          isOpen={meetingState === "isScheduleMeeting"}
          onClose={() => setMeetingState(undefined)}
          title="Meeting created"
          className="text-center"
          buttonText="Copy meeting link"
          handleClick={() => {
            navigator.clipboard.writeText(meetingLink);

            toast({ title: "Link copied." });
          }}
          image="/icons/checked.svg"
          buttonIcon="/icons/copy.svg"
          isLoading={isLoading}
        />
      )}

      <MeetingModal
        isOpen={false}
        onClose={() => {}}
        title=""
        className="hidden"
        buttonText=""
        handleClick={() => {}}
        isLoading={false}
      />

      <MeetingModal
        isOpen={meetingState === "isJoiningMeeting"}
        onClose={() => setMeetingState(undefined)}
        title="Type the link here"
        className="text-center"
        buttonText="Join Meeting"
        handleClick={() => router.push(values.link)}
        isLoading={isLoading}
      >
        <Input
          placeholder="Meeting link"
          onChange={(e) => setValues({ ...values, link: e.target.value })}
          className="border-none bg-dark-3"
        />
      </MeetingModal>
    </section>
  );
};
